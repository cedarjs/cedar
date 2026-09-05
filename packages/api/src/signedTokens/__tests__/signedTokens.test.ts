import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createSignedToken,
  SIGNED_TOKEN_SECRET_ENV_VAR,
  SignedTokenError,
  verifySignedToken,
} from '../signedTokens.js'
import type { SignedTokenErrorCode } from '../signedTokens.js'

const secret = 'MY_VOICE_IS_MY_PASSPORT_VERIFY_ME'
const purpose = 'google-oauth-state'
const payload = { organizationId: 'org_1', userId: 'user_1' }

function expectSignedTokenError(fn: () => unknown, code: SignedTokenErrorCode) {
  let thrown: unknown

  try {
    fn()
  } catch (e) {
    thrown = e
  }

  if (!(thrown instanceof SignedTokenError)) {
    throw new Error(`Expected a SignedTokenError, got ${String(thrown)}`)
  }

  expect(thrown).toMatchObject({ name: 'SignedTokenError', code })

  return thrown
}

describe('signed tokens', () => {
  beforeEach(() => {
    vi.stubEnv(SIGNED_TOKEN_SECRET_ENV_VAR, secret)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('createSignedToken', () => {
    test('produces a compact URL-safe token', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })

      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    })

    test('binds the purpose and sets an expiry', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))

      const token = createSignedToken({ payload, purpose, expiresIn: 60 })
      const claims = jwt.decode(token, { json: true })

      expect(claims).toMatchObject({ payload, purpose })
      expect(claims?.exp).toBe(claims!.iat! + 60)
    })

    test('signs with HS256', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '1h' })
      const decoded = jwt.decode(token, { complete: true })

      expect(decoded?.header.alg).toBe('HS256')
    })

    test('throws MISSING_PURPOSE for an empty purpose', () => {
      expectSignedTokenError(
        () => createSignedToken({ payload, purpose: '', expiresIn: '1h' }),
        'MISSING_PURPOSE',
      )
    })

    test('throws MISSING_SECRET when no secret is configured', () => {
      vi.stubEnv(SIGNED_TOKEN_SECRET_ENV_VAR, '')

      const error = expectSignedTokenError(
        () => createSignedToken({ payload, purpose, expiresIn: '1h' }),
        'MISSING_SECRET',
      )

      expect(error.message).toContain(SIGNED_TOKEN_SECRET_ENV_VAR)
      expect(error.message).toContain('yarn cedar generate secret')
    })

    test('does not fall back to the env var when an empty secret is passed', () => {
      expectSignedTokenError(
        () =>
          createSignedToken({ payload, purpose, expiresIn: '1h', secret: '' }),
        'MISSING_SECRET',
      )
    })

    test('throws SIGN_FAILED for an unparseable expiresIn', () => {
      const error = expectSignedTokenError(
        () =>
          createSignedToken({
            payload,
            purpose,
            // @ts-expect-error - deliberately passing an invalid duration
            expiresIn: 'soon-ish',
          }),
        'SIGN_FAILED',
      )

      expect(error.cause).toBeInstanceOf(Error)
    })
  })

  describe('verifySignedToken', () => {
    test('returns the payload for a valid token', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })

      expect(verifySignedToken(token, { purpose })).toEqual(payload)
    })

    test('round-trips payload keys that look like JWT claims', () => {
      const trickyPayload = { exp: 'not a timestamp', purpose: 'inner', iat: 1 }
      const token = createSignedToken({
        payload: trickyPayload,
        purpose,
        expiresIn: '10m',
      })

      expect(verifySignedToken(token, { purpose })).toEqual(trickyPayload)
    })

    test('uses an explicit secret over the env var', () => {
      const token = createSignedToken({
        payload,
        purpose,
        expiresIn: '10m',
        secret: 'another-secret',
      })

      expect(
        verifySignedToken(token, { purpose, secret: 'another-secret' }),
      ).toEqual(payload)
      expectSignedTokenError(
        () => verifySignedToken(token, { purpose }),
        'INVALID',
      )
    })

    test('throws PURPOSE_MISMATCH for a token created for another purpose', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })

      const error = expectSignedTokenError(
        () => verifySignedToken(token, { purpose: 'upload' }),
        'PURPOSE_MISMATCH',
      )

      expect(error.message).toContain(`'${purpose}'`)
      expect(error.message).toContain("'upload'")
    })

    test('throws EXPIRED once expiresIn has passed', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))

      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })

      vi.setSystemTime(new Date('2026-09-05T12:09:59Z'))
      expect(verifySignedToken(token, { purpose })).toEqual(payload)

      vi.setSystemTime(new Date('2026-09-05T12:10:01Z'))
      expectSignedTokenError(
        () => verifySignedToken(token, { purpose }),
        'EXPIRED',
      )
    })

    test('throws INVALID for a tampered payload', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })
      const [header, , signature] = token.split('.')
      const forgedClaims = Buffer.from(
        JSON.stringify({
          payload: { ...payload, userId: 'user_2' },
          purpose,
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
      ).toString('base64url')

      expectSignedTokenError(
        () =>
          verifySignedToken(`${header}.${forgedClaims}.${signature}`, {
            purpose,
          }),
        'INVALID',
      )
    })

    test('throws INVALID for a token signed with a different secret', () => {
      const token = createSignedToken({
        payload,
        purpose,
        expiresIn: '10m',
        secret: 'not so secret',
      })

      expectSignedTokenError(
        () => verifySignedToken(token, { purpose }),
        'INVALID',
      )
    })

    test('rejects an unsigned token (alg: none)', () => {
      const unsigned = jwt.sign({ payload, purpose }, '', {
        algorithm: 'none',
        expiresIn: '10m',
      })

      expectSignedTokenError(
        () => verifySignedToken(unsigned, { purpose }),
        'INVALID',
      )
    })

    test('rejects a correctly signed token that has no expiry', () => {
      const noExpiry = jwt.sign({ payload, purpose }, secret, {
        algorithm: 'HS256',
      })

      expectSignedTokenError(
        () => verifySignedToken(noExpiry, { purpose }),
        'INVALID',
      )
    })

    test('rejects a correctly signed token that has no purpose claim', () => {
      const noPurpose = jwt.sign({ payload }, secret, {
        algorithm: 'HS256',
        expiresIn: '10m',
      })

      expectSignedTokenError(
        () => verifySignedToken(noPurpose, { purpose }),
        'INVALID',
      )
    })

    test.each([undefined, null, ''])('throws MISSING_TOKEN for %o', (token) => {
      expectSignedTokenError(
        () => verifySignedToken(token, { purpose }),
        'MISSING_TOKEN',
      )
    })

    test('throws INVALID for garbage input', () => {
      expectSignedTokenError(
        () => verifySignedToken('definitely.not.a.token', { purpose }),
        'INVALID',
      )
    })

    test('throws MISSING_PURPOSE before touching the token', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })

      expectSignedTokenError(
        () => verifySignedToken(token, { purpose: '' }),
        'MISSING_PURPOSE',
      )
    })

    test('throws MISSING_SECRET when no secret is configured', () => {
      const token = createSignedToken({ payload, purpose, expiresIn: '10m' })
      vi.stubEnv(SIGNED_TOKEN_SECRET_ENV_VAR, '')

      expectSignedTokenError(
        () => verifySignedToken(token, { purpose }),
        'MISSING_SECRET',
      )
    })
  })
})
