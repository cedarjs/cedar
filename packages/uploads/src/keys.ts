import { randomUUID } from 'node:crypto'

import mime from 'mime-types'

import { UploadError } from './errors.js'

/**
 * A fresh storage key: a random id plus the extension that matches
 * `mimeType`, when one is known. Keys never derive from the client's
 * filename.
 */
export function generateStorageKey(mimeType: string): string {
  const ext = mime.extension(mimeType.split(';')[0].trim())

  return ext ? `${randomUUID()}.${ext}` : randomUUID()
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Rejects keys that could escape a provider's root: path separators, `..`,
 * leading dots, and anything outside a conservative character set. Providers
 * that map keys onto a filesystem call this before touching disk.
 */
export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new UploadError('INVALID_KEY', `Invalid storage key '${key}'.`)
  }
}
