import type { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { StorageProvider } from '../types.js'

export interface S3ProviderOptions {
  /** The app's own S3 client. It stays available for provider-specific work. */
  client: S3Client
  bucket: string
  /** Prepended to every key, for example `avatars/`. */
  keyPrefix?: string
  /** Lifetime of presigned upload URLs, in seconds. Defaults to 300. */
  uploadUrlExpiresIn?: number
  /** Lifetime of signed read URLs, in seconds. Defaults to 3600. */
  readUrlExpiresIn?: number
}

function isNotFound(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) {
    return false
  }

  const name = 'name' in e ? e.name : undefined
  const status =
    '$metadata' in e &&
    typeof e.$metadata === 'object' &&
    e.$metadata !== null &&
    'httpStatusCode' in e.$metadata
      ? e.$metadata.httpStatusCode
      : undefined

  return name === 'NotFound' || name === 'NoSuchKey' || status === 404
}

/**
 * Stores files in an S3 bucket (or any S3-compatible service) with the AWS
 * SDK. Import it from `@cedarjs/uploads/s3`; the SDK packages are optional
 * peer dependencies.
 */
export function createS3Provider(opts: S3ProviderOptions): StorageProvider {
  const {
    client,
    bucket,
    keyPrefix = '',
    uploadUrlExpiresIn = 300,
    readUrlExpiresIn = 3600,
  } = opts

  const fullKey = (key: string) => `${keyPrefix}${key}`

  const provider: StorageProvider = {
    name: '',
    providerType: 's3',

    async write(key, data, { contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey(key),
          Body: data,
          ContentType: contentType,
        }),
      )
    },

    async read(key) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) }),
      )

      if (!res.Body) {
        return Buffer.alloc(0)
      }

      return Buffer.from(await res.Body.transformToByteArray())
    },

    async readStream(key) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) }),
      )

      // On Node the SDK's Body is an IncomingMessage, which is a Readable.
      // The SDK types it as a union with browser streams, hence the cast.
      return res.Body as Readable
    },

    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(key) }),
      )
    },

    async exists(key) {
      return (await provider.getObjectSize(key)) !== null
    },

    async getObjectSize(key) {
      try {
        const res = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: fullKey(key) }),
        )

        return typeof res.ContentLength === 'number' ? res.ContentLength : null
      } catch (e) {
        if (isNotFound(e)) {
          return null
        }

        throw e
      }
    },

    async getSignedReadUrl(key, options = {}) {
      const { expiresIn = readUrlExpiresIn, disposition = 'attachment' } =
        options

      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: fullKey(key),
          // The stored MIME type is client-asserted, so inline is opt-in
          ResponseContentDisposition: disposition,
        }),
        { expiresIn },
      )
    },

    async getPresignedUploadUrl(key, { contentType, expiresIn }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey(key),
          ContentType: contentType,
        }),
        {
          expiresIn: expiresIn ?? uploadUrlExpiresIn,
          // Sign the content type as a header so the upload must send the
          // exact type the URL was issued for
          signableHeaders: new Set(['content-type']),
        },
      )

      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      }
    },

    getConfig() {
      return { bucket, region: client.config.region, keyPrefix }
    },
  }

  return provider
}
