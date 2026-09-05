import { randomUUID } from 'node:crypto'

import {
  createSignedToken,
  SignedTokenError,
  verifySignedToken,
} from '@cedarjs/api'
import type { SignedTokenExpiresIn } from '@cedarjs/api'

import { UploadError } from './errors.js'
import { DEFAULT_UPLOAD_TOKEN_EXPIRES_IN } from './profiles.js'

/** Purpose claim that separates upload tokens from every other signed token. */
export const UPLOAD_TOKEN_PURPOSE = 'cedar-upload'

export { UPLOAD_TOKEN_HEADER } from './constants.js'

/**
 * The claims inside an upload token. Constraints come from the server-side
 * profile; `sub` binds the token to the user it was issued to and `jti`
 * lets the server count how many files one token has created.
 */
export interface UploadTokenPayload {
  /** The profile the token was issued for. */
  profile: string
  allowedMimeTypes: string[]
  maxFileSize: number
  maxFiles: number
  /** The storage target files created with this token land on. */
  target: string
  /** Id of the user the token was issued to. */
  sub: string
  /** Unique token id, stamped onto each `Upload` row the token creates. */
  jti: string
  /** The organization the token was issued under, in multi-tenant apps. */
  organizationId?: string
}

export interface CreateUploadTokenOptions {
  payload: Omit<UploadTokenPayload, 'jti'> & { jti?: string }
  secret: string
  expiresIn?: SignedTokenExpiresIn
}

/** Signs an upload token. A fresh `jti` is generated unless one is passed. */
export function createUploadToken({
  payload,
  secret,
  expiresIn = DEFAULT_UPLOAD_TOKEN_EXPIRES_IN,
}: CreateUploadTokenOptions): string {
  return createSignedToken({
    payload: { ...payload, jti: payload.jti ?? randomUUID() },
    purpose: UPLOAD_TOKEN_PURPOSE,
    expiresIn,
    secret,
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isUploadTokenPayload(value: unknown): value is UploadTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const p = value as Record<string, unknown>

  return (
    typeof p.profile === 'string' &&
    isStringArray(p.allowedMimeTypes) &&
    typeof p.maxFileSize === 'number' &&
    typeof p.maxFiles === 'number' &&
    typeof p.target === 'string' &&
    typeof p.sub === 'string' &&
    typeof p.jti === 'string' &&
    (p.organizationId === undefined || typeof p.organizationId === 'string')
  )
}

/**
 * Verifies an upload token and returns its claims. Throws an `UploadError`
 * with code `INVALID_TOKEN` for a missing, expired, tampered, or foreign
 * token. The token argument accepts `null` and `undefined` so a header value
 * can be passed straight in.
 */
export function verifyUploadToken(
  token: string | null | undefined,
  { secret }: { secret: string },
): UploadTokenPayload {
  let payload: unknown

  try {
    payload = verifySignedToken(token, {
      purpose: UPLOAD_TOKEN_PURPOSE,
      secret,
    })
  } catch (e) {
    if (e instanceof SignedTokenError && e.code === 'MISSING_SECRET') {
      throw new UploadError('CONFIGURATION', e.message, e)
    }

    const detail = e instanceof SignedTokenError ? e.code : 'INVALID'

    throw new UploadError(
      'INVALID_TOKEN',
      `Invalid upload token (${detail}).`,
      e,
    )
  }

  if (!isUploadTokenPayload(payload)) {
    throw new UploadError('INVALID_TOKEN', 'Invalid upload token (MALFORMED).')
  }

  return payload
}
