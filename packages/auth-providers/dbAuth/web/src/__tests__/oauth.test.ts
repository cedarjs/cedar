import { vi, beforeEach, describe, it, expect } from 'vitest'

import { getOAuthUrl, unlinkOAuthProvider, getOAuthError } from '../oauth.js'

globalThis.RWJS_API_URL = '/.redwood/functions'

describe('getOAuthUrl', () => {
  it('defaults to the login flow using the default dbAuth URL', () => {
    expect(getOAuthUrl('google')).toBe(
      '/.redwood/functions/auth/oauth/google/authorize?flow=login',
    )
  })

  it('builds a signup flow URL', () => {
    expect(getOAuthUrl('google', { flow: 'signup' })).toBe(
      '/.redwood/functions/auth/oauth/google/authorize?flow=signup',
    )
  })

  it('builds a link flow URL', () => {
    expect(getOAuthUrl('github', { flow: 'link' })).toBe(
      '/.redwood/functions/auth/oauth/github/authorize?flow=link',
    )
  })

  it('uses a custom dbAuthUrl when provided', () => {
    expect(
      getOAuthUrl('github', { dbAuthUrl: '/.redwood/functions/dbauth' }),
    ).toBe('/.redwood/functions/dbauth/oauth/github/authorize?flow=login')
  })

  it('encodes the provider name', () => {
    expect(getOAuthUrl('my provider')).toBe(
      '/.redwood/functions/auth/oauth/my%20provider/authorize?flow=login',
    )
  })
})

describe('unlinkOAuthProvider', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('POSTs to the unlink route with credentials included', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    })

    const result = await unlinkOAuthProvider('google')

    expect(fetchMock).toHaveBeenCalledWith(
      '/.redwood/functions/auth/oauth/google/unlink',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-oauth-action': 'unlink' },
      },
    )
    expect(result).toEqual({ ok: true })
  })

  it('uses a custom dbAuthUrl when provided', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    })

    await unlinkOAuthProvider('github', {
      dbAuthUrl: '/.redwood/functions/dbauth',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/.redwood/functions/dbauth/oauth/github/unlink',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-oauth-action': 'unlink' },
      },
    )
  })

  it('returns the parsed error response', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ error: 'cannot_unlink_last_identity' }),
    })

    const result = await unlinkOAuthProvider('google')

    expect(result).toEqual({ error: 'cannot_unlink_last_identity' })
  })

  it('returns a server_error result instead of throwing when the response body is not valid JSON', async () => {
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    })

    const result = await unlinkOAuthProvider('google')

    expect(result).toEqual({ error: 'server_error' })
  })
})

describe('getOAuthError', () => {
  it('returns null when there is no error param', () => {
    expect(getOAuthError(new URLSearchParams(''))).toBeNull()
    expect(getOAuthError('')).toBeNull()
  })

  it('returns null for an unrecognized error code', () => {
    expect(getOAuthError('?error=not_a_real_code')).toBeNull()
  })

  it('extracts a known error code from a URLSearchParams instance', () => {
    expect(getOAuthError(new URLSearchParams('?error=invalid_state'))).toBe(
      'invalid_state',
    )
  })

  it('extracts a known error code from a query string', () => {
    expect(getOAuthError('?error=email_in_use')).toBe('email_in_use')
  })

  it('extracts a known error code alongside other params', () => {
    expect(getOAuthError('?flow=login&error=provider_error&foo=bar')).toBe(
      'provider_error',
    )
  })
})
