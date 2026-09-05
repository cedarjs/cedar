import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { UploadError } from '../errors.js'
import { assertSafeKey } from '../keys.js'
import {
  createServeToken,
  DEFAULT_SERVE_URL_EXPIRES_IN,
  SERVE_ROUTE_PATH,
  SERVE_TOKEN_PARAM,
} from '../serveToken.js'
import type { StorageProvider } from '../types.js'

export interface FsProviderOptions {
  /** Directory files are written to. Created on first write. */
  uploadDir: string
  /**
   * Origin (and optional path) the api server is reachable at, for example
   * `http://localhost:8911`. Required for `getSignedReadUrl()`.
   */
  serveBaseUrl?: string
  /**
   * Secret that signs serve URLs. Use the same value the upload plugin is
   * given as `tokenSecret`, because the serve route verifies with that.
   */
  signSecret?: string
  /** Prefix the upload plugin is registered under. Defaults to `/upload`. */
  routePrefix?: string
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e.code === 'ENOENT' || e.code === 'ENOTDIR')
  )
}

/**
 * Stores files on the local filesystem. Uploads reach it through the upload
 * plugin's `POST {prefix}/fs` route and are served by
 * `GET {prefix}/serve?token=...`.
 */
export function createFsProvider(opts: FsProviderOptions): StorageProvider {
  const { uploadDir, serveBaseUrl, signSecret, routePrefix = '/upload' } = opts

  const filePath = (key: string) => {
    assertSafeKey(key)

    return path.join(uploadDir, key)
  }

  const provider: StorageProvider = {
    name: '',
    providerType: 'fs',

    async write(key, data) {
      const target = filePath(key)
      await fs.mkdir(uploadDir, { recursive: true })
      await fs.writeFile(target, data)
    },

    async read(key) {
      return fs.readFile(filePath(key))
    },

    async readStream(key) {
      const target = filePath(key)

      // Surface a missing file as a rejected promise rather than a stream
      // error, so the serve route can answer 404 before any headers are sent
      await fs.access(target)

      return createReadStream(target)
    },

    async delete(key) {
      try {
        await fs.unlink(filePath(key))
      } catch (e) {
        if (!isNotFound(e)) {
          throw e
        }
      }
    },

    async exists(key) {
      try {
        await fs.access(filePath(key))

        return true
      } catch {
        return false
      }
    },

    async getObjectSize(key) {
      try {
        const stat = await fs.stat(filePath(key))

        return stat.size
      } catch (e) {
        if (isNotFound(e)) {
          return null
        }

        throw e
      }
    },

    async getSignedReadUrl(key, options = {}) {
      assertSafeKey(key)

      if (!signSecret || !serveBaseUrl) {
        throw new UploadError(
          'CONFIGURATION',
          `The FS storage target '${provider.name}' needs both ` +
            '`serveBaseUrl` and `signSecret` to generate signed read URLs.',
        )
      }

      const {
        expiresIn = DEFAULT_SERVE_URL_EXPIRES_IN,
        disposition = 'attachment',
      } = options

      const token = createServeToken({
        payload: { target: provider.name, key, disposition },
        secret: signSecret,
        expiresIn,
      })

      const base = serveBaseUrl.replace(/\/+$/, '')
      const prefix = routePrefix.replace(/\/+$/, '')

      const params = new URLSearchParams({ [SERVE_TOKEN_PARAM]: token })

      return `${base}${prefix}${SERVE_ROUTE_PATH}?${params}`
    },

    async getPresignedUploadUrl() {
      throw new UploadError(
        'PRESIGN_NOT_SUPPORTED',
        `The FS storage target '${provider.name}' does not support ` +
          'presigned uploads. Upload through the `POST {prefix}/fs` route.',
      )
    },

    getConfig() {
      return { uploadDir }
    },
  }

  return provider
}
