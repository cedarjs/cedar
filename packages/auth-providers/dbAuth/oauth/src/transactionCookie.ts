import {
  buildCookieAttributes,
  createExpiresAtDate,
  decryptSession,
  encryptSession,
} from '@cedarjs/auth-dbauth-api'
import type { DbAuthCookieConfig } from '@cedarjs/auth-dbauth-api'

import type { OAuthFlow } from './types.js'

export const TRANSACTION_COOKIE_NAME = 'oauth-transaction'

/** Default lifetime of the OAuth transaction cookie: 10 minutes. */
export const DEFAULT_TRANSACTION_EXPIRES_SECONDS = 60 * 10

export interface OAuthTransactionData {
  provider: string
  flow: OAuthFlow
  state: string
  codeVerifier: string
  nonce?: string
  /** Epoch milliseconds the transaction was created at, checked independently of the cookie's `Expires` attribute (which the browser, not the server, enforces). */
  createdAt: number
}

/**
 * Encodes transaction data for the cookie value. Reuses `encryptSession`
 * (AES-256-CBC keyed by `SESSION_SECRET`, same as the dbAuth session cookie)
 * for the encryption, but not `decryptSession`'s `data;csrf` string
 * convention — the payload is wrapped in a base64url string first so it can
 * never collide with the `;` that convention splits on.
 */
export function encodeTransactionCookie(data: OAuthTransactionData): string {
  const inner = Buffer.from(JSON.stringify(data), 'utf-8').toString('base64url')

  return encryptSession(JSON.stringify({ p: inner }))
}

/**
 * Decrypts and decodes a transaction cookie value produced by
 * `encodeTransactionCookie`. Returns `null` when the cookie is missing,
 * tampered with, or otherwise unreadable — the caller should treat that as
 * an expired/invalid transaction rather than a crash.
 */
export function decodeTransactionCookie(
  cookieValue: string | null | undefined,
): OAuthTransactionData | null {
  if (!cookieValue) {
    return null
  }

  try {
    const [wrapper] = decryptSession(cookieValue)

    if (
      !wrapper ||
      typeof wrapper !== 'object' ||
      typeof (wrapper as { p?: unknown }).p !== 'string'
    ) {
      return null
    }

    const json = Buffer.from(
      (wrapper as { p: string }).p,
      'base64url',
    ).toString('utf-8')

    return JSON.parse(json) as OAuthTransactionData
  } catch {
    return null
  }
}

/**
 * Returns `true` when the transaction was created more than
 * `expiresSeconds` ago. The cookie's own `Expires` attribute is enforced by
 * the browser, not the server, so this is checked independently.
 */
export function isTransactionExpired(
  data: OAuthTransactionData,
  expiresSeconds: number,
): boolean {
  return Date.now() - data.createdAt > expiresSeconds * 1000
}

/**
 * Builds the `Set-Cookie` header string for the OAuth transaction cookie.
 */
export function createTransactionCookieString({
  data,
  cookieConfig,
  expiresSeconds,
}: {
  data: OAuthTransactionData
  cookieConfig?: DbAuthCookieConfig
  expiresSeconds: number
}): string {
  const expiresAt = createExpiresAtDate(expiresSeconds)

  return [
    `${TRANSACTION_COOKIE_NAME}=${encodeTransactionCookie(data)}`,
    ...buildCookieAttributes({ cookieConfig, expires: expiresAt }),
  ].join(';')
}

/**
 * Builds the `Set-Cookie` header string that clears the OAuth transaction
 * cookie (used once the callback has consumed it, on both success and
 * failure — clearing on failure prevents a stale transaction from being
 * replayed).
 */
export function clearTransactionCookieString(
  cookieConfig?: DbAuthCookieConfig,
): string {
  return [
    `${TRANSACTION_COOKIE_NAME}=`,
    ...buildCookieAttributes({ cookieConfig, expires: 'now' }),
  ].join(';')
}

/**
 * Extracts the raw transaction cookie value out of a `Cookie` header string.
 */
export function getTransactionCookieValue(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) {
    return null
  }

  const cookie = cookieHeader
    .split(';')
    .find((c) => c.split('=')[0].trim() === TRANSACTION_COOKIE_NAME)

  if (!cookie || cookie === `${TRANSACTION_COOKIE_NAME}=`) {
    return null
  }

  return cookie.split('=').slice(1).join('=').trim()
}
