import { describe, expect, test, vi } from 'vitest'

import { createSignedToken } from '@cedarjs/api'

import {
  defineUploadProfiles,
  isMimeTypeAllowed,
  resolveProfile,
} from '../profiles.js'
import { createServeToken, verifyServeToken } from '../serveToken.js'
import {
  createUploadToken,
  UPLOAD_TOKEN_PURPOSE,
  verifyUploadToken,
} from '../uploadToken.js'

import { basePayload, SECRET, tokenFor } from './helpers/tokens.js'

describe('defineUploadProfiles', () => {
  test('returns the profiles it was given', () => {
    const profiles = defineUploadProfiles({
      avatar: {
        target: 'avatars',
        allowedMimeTypes: ['image/png'],
        maxFileSize: 1,
        maxFiles: 1,
      },
    })

    expect(profiles.avatar.target).toBe('avatars')
    expect(resolveProfile(profiles, 'avatar')).toEqual({
      ...profiles.avatar,
      name: 'avatar',
    })
  })

  test.each([
    [
      { target: '', allowedMimeTypes: ['a/b'], maxFileSize: 1, maxFiles: 1 },
      'target',
    ],
    [
      { target: 't', allowedMimeTypes: [], maxFileSize: 1, maxFiles: 1 },
      'allowedMimeTypes',
    ],
    [
      { target: 't', allowedMimeTypes: ['a/b'], maxFileSize: 0, maxFiles: 1 },
      'maxFileSize',
    ],
    [
      { target: 't', allowedMimeTypes: ['a/b'], maxFileSize: 1, maxFiles: 0 },
      'maxFiles',
    ],
    [
      { target: 't', allowedMimeTypes: ['a/b'], maxFileSize: 1, maxFiles: 1.5 },
      'maxFiles',
    ],
  ])('rejects an invalid profile %o', (profile, field) => {
    expect(() => defineUploadProfiles({ bad: profile })).toThrow(field)
  })

  test('throws UNKNOWN_PROFILE without listing profiles', () => {
    expect(() => resolveProfile({}, 'x')).toThrow("Unknown upload profile 'x'.")
  })
})

describe('isMimeTypeAllowed', () => {
  test('matches exact types, wildcards, and ignores parameters and case', () => {
    expect(isMimeTypeAllowed(['image/png'], 'image/png')).toBe(true)
    expect(isMimeTypeAllowed(['image/png'], 'IMAGE/PNG')).toBe(true)
    expect(isMimeTypeAllowed(['text/plain'], 'text/plain; charset=utf-8')).toBe(
      true,
    )
    expect(isMimeTypeAllowed(['image/*'], 'image/svg+xml')).toBe(true)
    expect(isMimeTypeAllowed(['*/*'], 'application/zip')).toBe(true)
    expect(isMimeTypeAllowed(['image/png'], 'image/jpeg')).toBe(false)
    expect(isMimeTypeAllowed(['image/*'], 'text/html')).toBe(false)
    expect(isMimeTypeAllowed(['image/*'], '')).toBe(false)
  })
})

describe('upload tokens', () => {
  test('round-trip with a generated jti', () => {
    const token = tokenFor()
    const payload = verifyUploadToken(token, { secret: SECRET })

    expect(payload).toMatchObject(basePayload)
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('keeps an explicit jti and organizationId', () => {
    const token = createUploadToken({
      payload: { ...basePayload, jti: 'jti_1', organizationId: 'org_1' },
      secret: SECRET,
    })

    expect(verifyUploadToken(token, { secret: SECRET })).toMatchObject({
      jti: 'jti_1',
      organizationId: 'org_1',
    })
  })

  test('rejects missing, foreign, expired, and wrong-purpose tokens', () => {
    expect(() => verifyUploadToken(undefined, { secret: SECRET })).toThrow(
      'Invalid upload token (MISSING_TOKEN).',
    )
    expect(() => verifyUploadToken(tokenFor(), { secret: 'other' })).toThrow(
      'Invalid upload token (INVALID).',
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const expiring = tokenFor({}, 60)
    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'))
    expect(() => verifyUploadToken(expiring, { secret: SECRET })).toThrow(
      'Invalid upload token (EXPIRED).',
    )
    vi.useRealTimers()

    const otherPurpose = createSignedToken({
      payload: basePayload,
      purpose: 'something-else',
      expiresIn: '5m',
      secret: SECRET,
    })
    expect(() => verifyUploadToken(otherPurpose, { secret: SECRET })).toThrow(
      'Invalid upload token (PURPOSE_MISMATCH).',
    )
  })

  test('rejects a validly signed token with malformed claims', () => {
    const malformed = createSignedToken({
      payload: { profile: 'avatar' },
      purpose: UPLOAD_TOKEN_PURPOSE,
      expiresIn: '5m',
      secret: SECRET,
    })

    expect(() => verifyUploadToken(malformed, { secret: SECRET })).toThrow(
      'Invalid upload token (MALFORMED).',
    )
  })

  test('reports a missing secret as a configuration error', () => {
    expect(() => verifyUploadToken(tokenFor(), { secret: '' })).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION' }),
    )
  })
})

describe('serve tokens', () => {
  test('round-trip', () => {
    const token = createServeToken({
      payload: { target: 'local', key: 'a.png', disposition: 'inline' },
      secret: SECRET,
    })

    expect(verifyServeToken(token, { secret: SECRET })).toEqual({
      target: 'local',
      key: 'a.png',
      disposition: 'inline',
    })
  })

  test('reports every failure as NOT_FOUND', () => {
    const token = createServeToken({
      payload: { target: 'local', key: 'a.png', disposition: 'inline' },
      secret: SECRET,
    })

    expect(() => verifyServeToken(token, { secret: 'other' })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    expect(() => verifyServeToken(null, { secret: SECRET })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
    expect(() => verifyServeToken(tokenFor(), { secret: SECRET })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
  })
})
