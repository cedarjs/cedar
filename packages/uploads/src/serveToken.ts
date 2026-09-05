import { createSignedToken, verifySignedToken } from '@cedarjs/api'

import { UploadError } from './errors.js'
import type { ContentDisposition } from './types.js'

/** Purpose claim for the signed URLs the FS serve route accepts. */
export const SERVE_TOKEN_PURPOSE = 'cedar-upload-serve'

/** Default lifetime of a signed serve URL, in seconds. */
export const DEFAULT_SERVE_URL_EXPIRES_IN = 3600

/** Route (relative to the plugin prefix) that serves files by token. */
export const SERVE_ROUTE_PATH = '/serve'

/**
 * Query parameter the serve route reads the token from. The token is a JWT,
 * which is longer than Fastify's default limit for path parameters.
 */
export const SERVE_TOKEN_PARAM = 'token'

export interface ServeTokenPayload {
  target: string
  key: string
  disposition: ContentDisposition
}

/**
 * Signs a serve token. The disposition is part of the signed payload, so
 * inline rendering is granted by whoever signs the URL, never by whoever
 * requests it.
 */
export function createServeToken({
  payload,
  secret,
  expiresIn = DEFAULT_SERVE_URL_EXPIRES_IN,
}: {
  payload: ServeTokenPayload
  secret: string
  /** Seconds. */
  expiresIn?: number
}): string {
  return createSignedToken({
    payload,
    purpose: SERVE_TOKEN_PURPOSE,
    expiresIn,
    secret,
  })
}

function isServeTokenPayload(value: unknown): value is ServeTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const p = value as Record<string, unknown>

  return (
    typeof p.target === 'string' &&
    typeof p.key === 'string' &&
    (p.disposition === 'attachment' || p.disposition === 'inline')
  )
}

/**
 * Verifies a serve token. Every failure is reported as `NOT_FOUND` so the
 * serve route does not distinguish an expired link from a forged one.
 */
export function verifyServeToken(
  token: string | null | undefined,
  { secret }: { secret: string },
): ServeTokenPayload {
  let payload: unknown

  try {
    payload = verifySignedToken(token, { purpose: SERVE_TOKEN_PURPOSE, secret })
  } catch (e) {
    throw new UploadError('NOT_FOUND', 'File not found.', e)
  }

  if (!isServeTokenPayload(payload)) {
    throw new UploadError('NOT_FOUND', 'File not found.')
  }

  return payload
}
