import type { Readable } from 'node:stream'

import fastifyMultipart from '@fastify/multipart'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { UploadAuthenticator } from '../authenticator.js'
import { UploadError } from '../errors.js'
import { generateStorageKey } from '../keys.js'
import {
  assertOwnership,
  assertTokenAllowsFile,
  createPendingUpload,
} from '../pending.js'
import { serializeUpload } from '../serialize.js'
import {
  SERVE_ROUTE_PATH,
  SERVE_TOKEN_PARAM,
  verifyServeToken,
} from '../serveToken.js'
import { resolveTarget } from '../targets.js'
import type { StorageTargets, UploadDatabase } from '../types.js'
import { UPLOAD_TOKEN_HEADER, verifyUploadToken } from '../uploadToken.js'
import type { UploadTokenPayload } from '../uploadToken.js'
import { handleS3Webhook } from '../webhooks/s3.js'
import type { FetchCertificate } from '../webhooks/sns.js'

const FIVE_HUNDRED_MB = 500 * 1024 * 1024

/** Bytes allowed for multipart boundaries, headers, and form fields. */
const MULTIPART_ENVELOPE_ALLOWANCE = 64 * 1024

export interface UploadPluginOptions {
  /** Secret upload tokens and serve URLs are signed with. */
  tokenSecret: string
  /** The app's storage targets. */
  targets: StorageTargets
  db: UploadDatabase
  /** Route prefix. Defaults to `/upload`. */
  prefix?: string
  /**
   * Hard outer ceiling on upload request size. Defaults to 500 MB. The
   * effective bound per request comes from the token (`maxFiles` times
   * `maxFileSize` plus a multipart envelope allowance), so this only needs
   * to sit above the largest profile's aggregate.
   */
  bodyLimit?: number
  /**
   * Resolves the requesting user so a token issued to someone else is
   * rejected. Build it with `createUploadAuthenticator()`. Without it the
   * token itself is the only identity on the route.
   */
  authenticate?: UploadAuthenticator
  /**
   * Enables `POST {prefix}/webhook/s3` for S3 event notifications delivered
   * through SNS. `topicArn` is the only topic accepted.
   */
  s3Webhook?: {
    topicArn: string
    fetchCertificate?: FetchCertificate
    fetch?: typeof fetch
  }
  /** `Cache-Control` for served files. Defaults to `private, max-age=3600`. */
  serveCacheControl?: string
}

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof UploadError) {
    return reply
      .code(e.statusCode)
      .send({ error: { code: e.code, message: e.message } })
  }

  throw e
}

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function contentDispositionHeader(
  disposition: 'attachment' | 'inline',
  filename: string,
) {
  // ASCII fallback plus RFC 5987 encoded form for everything else
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(filename)

  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Registers the upload routes on a Fastify server. Register it on the
 * `server` returned by `createServer()` in `api/src/server.ts`:
 *
 * - `POST {prefix}/fs` accepts multipart uploads for object-storage targets
 * - `GET {prefix}/serve?token=...` serves files behind signed URLs
 * - `POST {prefix}/webhook/s3` receives S3 event notifications (opt-in)
 * - `GET {prefix}/health` reports the configured targets
 */
export async function cedarUploadsPlugin(
  fastify: FastifyInstance,
  options: UploadPluginOptions,
): Promise<void> {
  const {
    tokenSecret,
    targets,
    db,
    prefix = '/upload',
    bodyLimit = FIVE_HUNDRED_MB,
    authenticate,
    s3Webhook,
    serveCacheControl = 'private, max-age=3600',
  } = options

  if (!tokenSecret) {
    throw new UploadError(
      'CONFIGURATION',
      'cedarUploadsPlugin needs a `tokenSecret`. Set UPLOAD_TOKEN_SECRET in ' +
        '.env (generate one with `yarn cedar generate secret`).',
    )
  }

  const base = prefix.replace(/\/+$/, '')

  await fastify.register(fastifyMultipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: bodyLimit },
  })

  const verifyRequestToken = async (
    req: FastifyRequest,
  ): Promise<UploadTokenPayload> => {
    const payload = verifyUploadToken(headerValue(req, UPLOAD_TOKEN_HEADER), {
      secret: tokenSecret,
    })

    if (authenticate) {
      const user = await authenticate(req)

      if (user) {
        assertOwnership(
          {
            userId: payload.sub,
            organizationId: payload.organizationId ?? null,
          },
          user,
          'this upload token',
        )
      }
    }

    return payload
  }

  fastify.post(`${base}/fs`, { bodyLimit }, async (req, reply) => {
    try {
      const payload = await verifyRequestToken(req)
      const target = resolveTarget(targets, payload.target)

      if (target.providerType === 'db') {
        throw new UploadError(
          'NOT_SUPPORTED',
          `Upload profile '${payload.profile}' stores files inline in the ` +
            'database. Send them as base64 through GraphQL instead.',
        )
      }

      const requestBound =
        payload.maxFiles * payload.maxFileSize + MULTIPART_ENVELOPE_ALLOWANCE
      const contentLength = Number(headerValue(req, 'content-length'))

      if (Number.isFinite(contentLength) && contentLength > requestBound) {
        throw new UploadError(
          'FILE_TOO_LARGE',
          `Request body of ${contentLength} bytes exceeds what upload ` +
            `profile '${payload.profile}' allows.`,
        )
      }

      if (!req.isMultipart()) {
        throw new UploadError(
          'NOT_SUPPORTED',
          'Upload requests must be multipart/form-data.',
        )
      }

      const uploads = []

      for await (const part of req.parts({
        limits: { fileSize: payload.maxFileSize, files: payload.maxFiles },
      })) {
        if (part.type !== 'file') {
          continue
        }

        assertTokenAllowsFile(payload, { contentType: part.mimetype, size: 0n })

        let data: Buffer

        try {
          data = await part.toBuffer()
        } catch (e) {
          if (
            typeof e === 'object' &&
            e !== null &&
            'code' in e &&
            e.code === 'FST_REQ_FILE_TOO_LARGE'
          ) {
            throw new UploadError(
              'FILE_TOO_LARGE',
              `File '${part.filename}' exceeds the ${payload.maxFileSize} ` +
                `byte limit for upload profile '${payload.profile}'.`,
            )
          }

          throw e
        }

        const size = BigInt(data.byteLength)
        assertTokenAllowsFile(payload, { contentType: part.mimetype, size })

        const storageKey = generateStorageKey(part.mimetype)

        // Row first: a crash between the row and the write leaves a pending
        // row the cleanup job can find, whereas bytes-first would leave an
        // object on disk that nothing references
        const upload = await createPendingUpload({
          db,
          payload,
          filename: part.filename,
          mimeType: part.mimetype,
          size,
          storageKey,
        })

        await target.write(storageKey, data, { contentType: part.mimetype })

        await db.upload.updateMany({
          where: { id: upload.id, status: 'pending' },
          data: { status: 'completed' },
        })

        uploads.push(serializeUpload({ ...upload, status: 'completed' }))
      }

      if (uploads.length === 0) {
        throw new UploadError('NOT_SUPPORTED', 'No file was included.')
      }

      return reply.code(201).send({ uploads })
    } catch (e) {
      return sendError(reply, e)
    }
  })

  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    `${base}${SERVE_ROUTE_PATH}`,
    async (req, reply) => {
      try {
        const {
          target: targetName,
          key,
          disposition,
        } = verifyServeToken(req.query[SERVE_TOKEN_PARAM], {
          secret: tokenSecret,
        })

        const target = resolveTarget(targets, targetName)
        const upload = await db.upload.findFirst({
          where: { target: targetName, storageKey: key, status: 'completed' },
          omit: { data: true },
        })

        if (!upload) {
          throw new UploadError('NOT_FOUND', 'File not found.')
        }

        const etag = `"${upload.id}-${upload.updatedAt.getTime()}"`

        if (headerValue(req, 'if-none-match') === etag) {
          return reply.code(304).send()
        }

        let body: Readable | Buffer

        try {
          body = target.readStream
            ? await target.readStream(key)
            : await target.read(key)
        } catch (e) {
          throw new UploadError('NOT_FOUND', 'File not found.', e)
        }

        return reply
          .code(200)
          .header('Content-Type', upload.mimeType)
          .header('Content-Length', upload.size.toString())
          .header(
            'Content-Disposition',
            contentDispositionHeader(disposition, upload.filename),
          )
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', serveCacheControl)
          .header('ETag', etag)
          .send(body)
      } catch (e) {
        return sendError(reply, e)
      }
    },
  )

  if (s3Webhook) {
    // SNS posts JSON with a text/plain content type
    fastify.addContentTypeParser(
      ['text/plain', 'application/json'],
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    )

    fastify.post<{ Body: string }>(`${base}/webhook/s3`, async (req, reply) => {
      try {
        const body =
          typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

        const result = await handleS3Webhook(body, {
          db,
          targets,
          topicArn: s3Webhook.topicArn,
          fetchCertificate: s3Webhook.fetchCertificate,
          fetch: s3Webhook.fetch,
        })

        return reply.code(200).send(result)
      } catch (e) {
        return sendError(reply, e)
      }
    })
  }

  fastify.get(`${base}/health`, async () => {
    return {
      ok: true,
      targets: Object.entries(targets).map(([name, target]) => ({
        name,
        providerType: target.providerType,
      })),
    }
  })
}
