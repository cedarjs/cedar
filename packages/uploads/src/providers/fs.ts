import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { UploadError } from '../errors.js'
import { assertSafeKey, trimTrailingSlashes } from '../keys.js'
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
   * `https://api.example.com`. Required for `getSignedReadUrl()`. Signed
   * URLs carry a bearer token, so the origin must use `https:` unless it
   * is a loopback address used in development.
   */
  serveBaseUrl?: string
  /**
   * Secret that signs serve URLs. Use the same value the upload plugin is
   * given as `tokenSecret`, because the serve route verifies with that.
   */
  signSecret?: string
  /**
   * Prefix the upload plugin is registered under. Defaults to `/upload`.
   */
  routePrefix?: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e.code === 'ENOENT' || e.code === 'ENOTDIR')
  )
}

/**
 * Validates the origin signed URLs are built on. Plain `http:` is only
 * accepted for loopback hosts, so a bearer token never travels in clear
 * text to a real network address.
 */
export function assertServeBaseUrl(serveBaseUrl: string, targetName: string) {
  let parsed: URL

  try {
    parsed = new URL(serveBaseUrl)
  } catch {
    throw new UploadError(
      'CONFIGURATION',
      `The FS storage target '${targetName}' has an invalid serveBaseUrl: ` +
        `'${serveBaseUrl}'.`,
    )
  }

  const secure =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()))

  if (!secure) {
    throw new UploadError(
      'CONFIGURATION',
      `The FS storage target '${targetName}' has serveBaseUrl ` +
        `'${serveBaseUrl}'. Signed URLs carry a bearer token, so the origin ` +
        'must use https, or http on localhost for development.',
    )
  }
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
      } catch (e) {
        // Only a missing path means "does not exist"; permission and I/O
        // failures are storage errors the caller must see
        if (isNotFound(e)) {
          return false
        }

        throw e
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

      assertServeBaseUrl(serveBaseUrl, provider.name)

      const {
        expiresIn = DEFAULT_SERVE_URL_EXPIRES_IN,
        disposition = 'attachment',
      } = options

      const token = createServeToken({
        payload: { target: provider.name, key, disposition },
        secret: signSecret,
        expiresIn,
      })

      const base = trimTrailingSlashes(serveBaseUrl)
      const prefix = trimTrailingSlashes(routePrefix)
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
