import { describe, it, expect } from 'vitest'

import {
  normalizeOAuthRequest,
  parseAuthorizeFlow,
  parseOAuthRoute,
} from '../request'

describe('parseOAuthRoute()', () => {
  it('parses an authorize route', () => {
    expect(
      parseOAuthRoute('/auth/oauth/google/authorize', '/auth/oauth'),
    ).toEqual({
      provider: 'google',
      action: 'authorize',
    })
  })

  it('parses a callback route', () => {
    expect(
      parseOAuthRoute('/auth/oauth/github/callback', '/auth/oauth'),
    ).toEqual({
      provider: 'github',
      action: 'callback',
    })
  })

  it('parses an unlink route', () => {
    expect(parseOAuthRoute('/auth/oauth/github/unlink', '/auth/oauth')).toEqual(
      {
        provider: 'github',
        action: 'unlink',
      },
    )
  })

  it('respects a custom base path', () => {
    expect(parseOAuthRoute('/api/oauth/google/callback', '/api/oauth')).toEqual(
      {
        provider: 'google',
        action: 'callback',
      },
    )
  })

  it('returns null for a path outside basePath', () => {
    expect(parseOAuthRoute('/auth/login', '/auth/oauth')).toBeNull()
  })

  it('returns null for an unrecognized action', () => {
    expect(
      parseOAuthRoute('/auth/oauth/google/logout', '/auth/oauth'),
    ).toBeNull()
  })

  it('returns null for a missing provider segment', () => {
    expect(parseOAuthRoute('/auth/oauth/authorize', '/auth/oauth')).toBeNull()
  })

  it('returns null for extra path segments', () => {
    expect(
      parseOAuthRoute('/auth/oauth/google/authorize/extra', '/auth/oauth'),
    ).toBeNull()
  })
})

describe('parseAuthorizeFlow()', () => {
  it('defaults to login', () => {
    expect(parseAuthorizeFlow({})).toBe('login')
  })

  it('accepts signup and link', () => {
    expect(parseAuthorizeFlow({ flow: 'signup' })).toBe('signup')
    expect(parseAuthorizeFlow({ flow: 'link' })).toBe('link')
  })

  it('falls back to login for unrecognized values', () => {
    expect(parseAuthorizeFlow({ flow: 'unlink' })).toBe('login')
    expect(parseAuthorizeFlow({ flow: 'nonsense' })).toBe('login')
  })
})

describe('normalizeOAuthRequest()', () => {
  it('normalizes a Lambda-style GET event with query params', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/auth/oauth/google/callback',
      headers: { host: 'example.com' },
      queryStringParameters: { code: 'abc', state: 'xyz' },
      body: null,
      isBase64Encoded: false,
    } as any

    const normalized = await normalizeOAuthRequest(event)

    expect(normalized.method).toBe('GET')
    expect(normalized.path).toBe('/auth/oauth/google/callback')
    expect(normalized.query).toEqual({ code: 'abc', state: 'xyz' })
    expect(normalized.form).toEqual({})
  })

  it('drops undefined query string values from a Lambda-style event', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/auth/oauth/google/callback',
      headers: {},
      queryStringParameters: { code: 'abc', missing: undefined },
      body: null,
      isBase64Encoded: false,
    } as any

    const normalized = await normalizeOAuthRequest(event)

    expect(normalized.query).toEqual({ code: 'abc' })
  })

  it('parses a form-urlencoded Lambda-style POST body (form_post callback)', async () => {
    const event = {
      httpMethod: 'POST',
      path: '/auth/oauth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      queryStringParameters: {},
      body: 'code=abc&state=xyz&user=%7B%22name%22%3A%22Ada%22%7D',
      isBase64Encoded: false,
    } as any

    const normalized = await normalizeOAuthRequest(event)

    expect(normalized.form).toEqual({
      code: 'abc',
      state: 'xyz',
      user: '{"name":"Ada"}',
    })
  })

  it('decodes a base64-encoded Lambda-style form body', async () => {
    const raw = 'code=abc&state=xyz'
    const event = {
      httpMethod: 'POST',
      path: '/auth/oauth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      queryStringParameters: {},
      body: Buffer.from(raw, 'utf-8').toString('base64'),
      isBase64Encoded: true,
    } as any

    const normalized = await normalizeOAuthRequest(event)

    expect(normalized.form).toEqual({ code: 'abc', state: 'xyz' })
  })

  it('normalizes a Fetch Request GET with query params', async () => {
    const request = new Request(
      'https://example.com/auth/oauth/google/callback?code=abc&state=xyz',
    )

    const normalized = await normalizeOAuthRequest(request)

    expect(normalized.method).toBe('GET')
    expect(normalized.path).toBe('/auth/oauth/google/callback')
    expect(normalized.query).toEqual({ code: 'abc', state: 'xyz' })
    expect(normalized.form).toEqual({})
  })

  it('parses a form-urlencoded Fetch Request POST body', async () => {
    const request = new Request(
      'https://example.com/auth/oauth/apple/callback',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'code=abc&state=xyz',
      },
    )

    const normalized = await normalizeOAuthRequest(request)

    expect(normalized.form).toEqual({ code: 'abc', state: 'xyz' })
  })

  it('does not attempt to parse a non-form Fetch Request body as form data', async () => {
    const request = new Request(
      'https://example.com/auth/oauth/google/unlink',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google' }),
      },
    )

    const normalized = await normalizeOAuthRequest(request)

    expect(normalized.form).toEqual({})
  })
})
