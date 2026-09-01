import { describe, it, expect, beforeEach } from 'vitest'

import {
  clearTransactionCookieString,
  createTransactionCookieString,
  decodeTransactionCookie,
  encodeTransactionCookie,
  getTransactionCookieValue,
  isTransactionExpired,
  TRANSACTION_COOKIE_NAME,
} from '../transactionCookie'
import type { OAuthTransactionData } from '../transactionCookie'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

const sampleData: OAuthTransactionData = {
  provider: 'google',
  flow: 'login',
  state: 'the-state',
  codeVerifier: 'the-code-verifier',
  nonce: 'the-nonce',
  createdAt: Date.now(),
}

describe('encodeTransactionCookie() / decodeTransactionCookie()', () => {
  it('round-trips transaction data', () => {
    const encoded = encodeTransactionCookie(sampleData)
    const decoded = decodeTransactionCookie(encoded)

    expect(decoded).toEqual(sampleData)
  })

  it('round-trips values containing semicolons without truncation', () => {
    const data: OAuthTransactionData = {
      ...sampleData,
      state: 'weird;state;with;semicolons',
    }

    const decoded = decodeTransactionCookie(encodeTransactionCookie(data))

    expect(decoded).toEqual(data)
  })

  it('returns null for a missing cookie value', () => {
    expect(decodeTransactionCookie(null)).toBeNull()
    expect(decodeTransactionCookie(undefined)).toBeNull()
    expect(decodeTransactionCookie('')).toBeNull()
  })

  it('returns null for a tampered cookie value', () => {
    const encoded = encodeTransactionCookie(sampleData)
    const tampered = encoded.slice(0, -4) + 'abcd'

    expect(decodeTransactionCookie(tampered)).toBeNull()
  })

  it('returns null when the encryption key changes', () => {
    const encoded = encodeTransactionCookie(sampleData)
    process.env.SESSION_SECRET = 'a-completely-different-secret-value'

    expect(decodeTransactionCookie(encoded)).toBeNull()
  })
})

describe('isTransactionExpired()', () => {
  it('is false for a fresh transaction', () => {
    expect(
      isTransactionExpired({ ...sampleData, createdAt: Date.now() }, 600),
    ).toBe(false)
  })

  it('is true once the configured window has elapsed', () => {
    const createdAt = Date.now() - 601_000
    expect(isTransactionExpired({ ...sampleData, createdAt }, 600)).toBe(true)
  })
})

describe('createTransactionCookieString() / getTransactionCookieValue()', () => {
  it('builds a Set-Cookie string whose value round-trips through decodeTransactionCookie', () => {
    const setCookie = createTransactionCookieString({
      data: sampleData,
      expiresSeconds: 600,
    })

    expect(setCookie).toContain(`${TRANSACTION_COOKIE_NAME}=`)

    const value = getTransactionCookieValue(setCookie)
    expect(decodeTransactionCookie(value)).toEqual(sampleData)
  })

  it('applies cookie attributes from cookieConfig', () => {
    const setCookie = createTransactionCookieString({
      data: sampleData,
      expiresSeconds: 600,
      cookieConfig: {
        attributes: { HttpOnly: true, Path: '/', SameSite: 'Lax' },
      },
    })

    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('SameSite=Lax')
  })
})

describe('clearTransactionCookieString()', () => {
  it('expires the cookie in the past with an empty value', () => {
    const setCookie = clearTransactionCookieString()

    expect(setCookie).toContain(`${TRANSACTION_COOKIE_NAME}=;`)
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })
})

describe('getTransactionCookieValue()', () => {
  it('finds the transaction cookie among other cookies', () => {
    const header = `foo=bar; ${TRANSACTION_COOKIE_NAME}=abc123; session=xyz`
    expect(getTransactionCookieValue(header)).toBe('abc123')
  })

  it('returns null when the cookie is absent', () => {
    expect(getTransactionCookieValue('foo=bar')).toBeNull()
    expect(getTransactionCookieValue(null)).toBeNull()
  })
})
