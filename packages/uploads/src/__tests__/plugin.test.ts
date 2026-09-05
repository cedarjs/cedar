import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { cedarUploadsPlugin } from '../fastify/plugin.js'
import { createDbProvider } from '../providers/db.js'
import { createFsProvider } from '../providers/fs.js'
import { storeFile } from '../storeFile.js'
import { defineStorageTargets } from '../targets.js'

import { db, prisma, resetTestDb } from './helpers/testDb.js'
import { SECRET, tokenFor } from './helpers/tokens.js'

interface Part {
  field?: string
  filename: string
  type: string
  content: string | Buffer
}

function multipart(parts: Part[]) {
  const boundary = '----CedarTestBoundary'
  const chunks: Buffer[] = []

  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${part.field ?? 'file'}"; ` +
          `filename="${part.filename}"\r\n` +
          `Content-Type: ${part.type}\r\n\r\n`,
      ),
      Buffer.from(part.content),
      Buffer.from('\r\n'),
    )
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  const payload = Buffer.concat(chunks)

  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.byteLength),
    },
  }
}

describe('cedarUploadsPlugin', () => {
  let uploadDir: string
  let app: FastifyInstance
  let targets: ReturnType<typeof makeTargets>

  function makeTargets(dir: string) {
    return defineStorageTargets({
      local: createFsProvider({
        uploadDir: dir,
        serveBaseUrl: 'http://localhost:8911',
        signSecret: SECRET,
      }),
      thumbs: createDbProvider(),
    })
  }

  beforeEach(async () => {
    await resetTestDb()
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cedar-uploads-plugin-'),
    )
    targets = makeTargets(uploadDir)
    app = Fastify()

    await app.register(cedarUploadsPlugin, {
      tokenSecret: SECRET,
      targets,
      db,
      authenticate: async (req) => {
        const id = req.headers['x-test-user']
        return typeof id === 'string' ? { id } : null
      },
    })

    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await fs.rm(uploadDir, { recursive: true, force: true })
  })

  test('GET /upload/health lists targets', async () => {
    const res = await app.inject({ method: 'GET', url: '/upload/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      targets: [
        { name: 'local', providerType: 'fs' },
        { name: 'thumbs', providerType: 'db' },
      ],
    })
  })

  describe('POST /upload/fs', () => {
    test('stores each file and returns completed uploads', async () => {
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'hello' },
        { filename: 'b.txt', type: 'text/plain', content: 'world!' },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: { ...body.headers, 'x-upload-token': tokenFor() },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(201)
      const { uploads } = res.json()
      expect(uploads).toHaveLength(2)
      expect(uploads[0]).toMatchObject({
        target: 'local',
        status: 'completed',
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: '5',
        userId: 'user_1',
      })
      expect(uploads[0]).not.toHaveProperty('data')
      expect(uploads[0]).not.toHaveProperty('tokenId')

      const onDisk = await fs.readFile(
        path.join(uploadDir, uploads[1].storageKey),
      )
      expect(onDisk.toString()).toBe('world!')

      const rows = await prisma.upload.findMany()
      expect(rows.every((r) => r.status === 'completed')).toBe(true)
    })

    test('rejects a missing or invalid token', async () => {
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'x' },
      ])

      const missing = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: body.headers,
        payload: body.payload,
      })
      expect(missing.statusCode).toBe(401)
      expect(missing.json().error.code).toBe('INVALID_TOKEN')

      const bad = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: { ...body.headers, 'x-upload-token': 'nope' },
        payload: body.payload,
      })
      expect(bad.statusCode).toBe(401)
    })

    test('rejects a token issued to a different user', async () => {
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'x' },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: {
          ...body.headers,
          'x-upload-token': tokenFor(),
          'x-test-user': 'someone_else',
        },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
      expect(await prisma.upload.count()).toBe(0)
    })

    test('accepts the token when the requester matches', async () => {
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'x' },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: {
          ...body.headers,
          'x-upload-token': tokenFor(),
          'x-test-user': 'user_1',
        },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(201)
    })

    test('rejects disallowed MIME types', async () => {
      const body = multipart([
        { filename: 'a.zip', type: 'application/zip', content: 'x' },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: { ...body.headers, 'x-upload-token': tokenFor() },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(415)
      expect(await prisma.upload.count()).toBe(0)
    })

    test('rejects a request whose Content-Length exceeds the token bound', async () => {
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'x' },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: {
          ...body.headers,
          'content-length': String(10 * 1024 * 1024),
          'x-upload-token': tokenFor(),
        },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(413)
    })

    test('rejects a file larger than maxFileSize mid-stream', async () => {
      const body = multipart([
        {
          filename: 'big.txt',
          type: 'text/plain',
          content: Buffer.alloc(2048, 'a'),
        },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: {
          ...body.headers,
          'x-upload-token': tokenFor({ maxFileSize: 1024 }),
        },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(413)
      expect(res.json().error.code).toBe('FILE_TOO_LARGE')
      expect(await prisma.upload.count()).toBe(0)
    })

    test('enforces maxFiles across requests sharing a token', async () => {
      const token = tokenFor({ maxFiles: 1 })
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'x' },
      ])

      const first = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: { ...body.headers, 'x-upload-token': token },
        payload: body.payload,
      })
      expect(first.statusCode).toBe(201)

      const second = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: { ...body.headers, 'x-upload-token': token },
        payload: body.payload,
      })
      expect(second.statusCode).toBe(400)
      expect(second.json().error.code).toBe('TOO_MANY_FILES')
    })

    test('refuses DB targets', async () => {
      const body = multipart([
        { filename: 'a.txt', type: 'text/plain', content: 'x' },
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/upload/fs',
        headers: {
          ...body.headers,
          'x-upload-token': tokenFor({ target: 'thumbs' }),
        },
        payload: body.payload,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('NOT_SUPPORTED')
    })
  })

  describe('GET /upload/serve', () => {
    test('serves a completed file with safe headers', async () => {
      const upload = await storeFile(targets.local, {
        db,
        filename: 'räport "final".txt',
        mimeType: 'text/plain',
        data: Buffer.from('served'),
      })

      const url = await targets.local.getSignedReadUrl(upload.storageKey!)
      const res = await app.inject({ method: 'GET', url })

      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('served')
      expect(res.headers['content-type']).toBe('text/plain')
      expect(res.headers['content-length']).toBe('6')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['cache-control']).toBe('private, max-age=3600')
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="r_port _final_.txt"; filename*=UTF-8''r%C3%A4port%20%22final%22.txt`,
      )
      expect(res.headers.etag).toMatch(/^".+"$/)

      const cached = await app.inject({
        method: 'GET',
        url,
        headers: { 'if-none-match': String(res.headers.etag) },
      })
      expect(cached.statusCode).toBe(304)
    })

    test('honors inline disposition signed into the URL', async () => {
      const upload = await storeFile(targets.local, {
        db,
        filename: 'a.png',
        mimeType: 'image/png',
        data: Buffer.from('png'),
      })

      const url = await targets.local.getSignedReadUrl(upload.storageKey!, {
        disposition: 'inline',
      })
      const res = await app.inject({ method: 'GET', url })

      expect(res.headers['content-disposition']).toMatch(/^inline;/)
    })

    test('answers 404 for forged tokens, missing rows, and missing files', async () => {
      const forged = await app.inject({
        method: 'GET',
        url: '/upload/serve?token=not-a-token',
      })
      expect(forged.statusCode).toBe(404)

      const noToken = await app.inject({ method: 'GET', url: '/upload/serve' })
      expect(noToken.statusCode).toBe(404)

      const noRow = await app.inject({
        method: 'GET',
        url: await targets.local.getSignedReadUrl('ghost.txt'),
      })
      expect(noRow.statusCode).toBe(404)

      const upload = await storeFile(targets.local, {
        db,
        filename: 'a.txt',
        mimeType: 'text/plain',
        data: Buffer.from('x'),
      })
      await fs.rm(path.join(uploadDir, upload.storageKey!))

      const noFile = await app.inject({
        method: 'GET',
        url: await targets.local.getSignedReadUrl(upload.storageKey!),
      })
      expect(noFile.statusCode).toBe(404)
    })

    test('does not serve pending rows', async () => {
      await prisma.upload.create({
        data: {
          target: 'local',
          status: 'pending',
          filename: 'a.txt',
          mimeType: 'text/plain',
          size: 1n,
          storageKey: 'pending.txt',
        },
      })
      await fs.writeFile(path.join(uploadDir, 'pending.txt'), 'x')

      const res = await app.inject({
        method: 'GET',
        url: await targets.local.getSignedReadUrl('pending.txt'),
      })

      expect(res.statusCode).toBe(404)
    })
  })

  test('refuses to register without a token secret', async () => {
    const bare = Fastify()

    await expect(
      bare.register(cedarUploadsPlugin, { tokenSecret: '', targets, db }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION' })
  })
})
