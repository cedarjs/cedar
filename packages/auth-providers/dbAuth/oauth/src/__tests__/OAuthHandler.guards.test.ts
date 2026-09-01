import type { APIGatewayProxyEvent } from 'aws-lambda'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  createExpiresAtDate,
  createLoginResponse,
  decryptSession,
  getSession,
} from '@cedarjs/auth-dbauth-api'

import { OAuthHandler } from '../OAuthHandler'
import { createTransactionCookieString } from '../transactionCookie'
import type { OAuthTransactionData } from '../transactionCookie'
import type {
  OAuthFlow,
  OAuthHandlerOptions,
  OAuthStrategy,
  OAuthUserInfo,
} from '../types'

import { DbMock } from './mockDb'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

function mockStrategy(
  overrides: Partial<OAuthStrategy> & { profile?: OAuthUserInfo } = {},
): OAuthStrategy {
  const { profile, ...rest } = overrides
  return {
    name: 'Mock',
    redirectUri: 'https://example.com/auth/oauth/mock/callback',
    usesOidc: false,
    getAuthorizationUrl: () =>
      new URL('https://provider.example.com/authorize'),
    handleCallback: async () => profile ?? { providerUserId: 'default-id' },
    ...rest,
  }
}

function transactionCookieHeader(
  data: Partial<OAuthTransactionData> &
    Pick<OAuthTransactionData, 'provider' | 'flow'>,
): string {
  const full: OAuthTransactionData = {
    state: 'test-state',
    codeVerifier: 'test-verifier',
    createdAt: Date.now(),
    ...data,
  }
  return createTransactionCookieString({
    data: full,
    expiresSeconds: 600,
  }).split(';')[0]
}

function sessionCookieHeaderFor(user: Record<string, unknown>): string {
  const [, headers] = createLoginResponse(user, {
    expiresAt: createExpiresAtDate(3600),
  })
  const setCookie = headers.getSetCookie().find((c) => c.startsWith('session='))
  if (!setCookie) {
    throw new Error('expected a session cookie to be set')
  }
  return setCookie.split(';')[0]
}

function cookieHeader(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('; ')
}

function callbackEvent({
  provider,
  query = {},
  cookie,
  method = 'GET',
}: {
  provider: string
  query?: Record<string, string>
  cookie?: string
  method?: string
}): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path: `/auth/oauth/${provider}/callback`,
    headers: cookie ? { cookie } : {},
    queryStringParameters: query,
    body: null,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent
}

function authorizeEvent({
  provider,
  flow,
  cookie,
}: {
  provider: string
  flow?: OAuthFlow
  cookie?: string
}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: `/auth/oauth/${provider}/authorize`,
    headers: cookie ? { cookie } : {},
    queryStringParameters: flow ? { flow } : {},
    body: null,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent
}

function unlinkEvent({
  provider,
  cookie,
  withOAuthAction = true,
}: {
  provider: string
  cookie?: string
  /** Whether to send the `x-oauth-action` CSRF-defense header. Defaults to `true`. */
  withOAuthAction?: boolean
}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: `/auth/oauth/${provider}/unlink`,
    headers: {
      ...(cookie ? { cookie, 'content-type': 'application/json' } : {}),
      ...(withOAuthAction ? { 'x-oauth-action': 'unlink' } : {}),
    },
    queryStringParameters: {},
    body: '{}',
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent
}

function locationOf(response: any): string {
  return response.headers.location ?? response.headers.Location
}

function errorCodeOf(response: any): string | null {
  const location = locationOf(response)
  if (!location) {
    return null
  }
  return new URL(location, 'https://example.com').searchParams.get('error')
}

function setCookiesOf(response: any): string[] {
  const value =
    response.headers['set-cookie'] ?? response.multiValueHeaders?.['Set-Cookie']
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function decryptedSessionFrom(response: any): Record<string, unknown> | null {
  const sessionCookie = setCookiesOf(response).find((c) =>
    c.startsWith('session='),
  )
  if (!sessionCookie) {
    return null
  }
  const value = getSession(sessionCookie, undefined)
  const [session] = decryptSession(value)
  return session
}

describe('OAuthHandler guards', () => {
  let db: DbMock
  let baseOptions: OAuthHandlerOptions<any>

  beforeEach(() => {
    db = new DbMock(['user', 'oAuth'])

    baseOptions = {
      db,
      authModelAccessor: 'user',
      oauthModelAccessor: 'oAuth',
      authFields: {
        id: 'id',
        username: 'email',
        hashedPassword: 'hashedPassword',
      },
      providers: {},
      redirects: {
        afterLogin: '/dashboard',
        afterSignup: '/welcome',
        afterLink: '/account',
        error: '/auth/error',
      },
      signup: {
        handler: ({ profile }) =>
          db.user.create({
            data: { email: profile.email, name: profile.username },
          }),
      },
      sessionExpires: 60 * 60,
    }
  })

  describe('authorize', () => {
    it('redirects with unknown_provider for an unconfigured provider', async () => {
      const handler = new OAuthHandler(
        authorizeEvent({ provider: 'nope' }),
        {} as any,
        baseOptions,
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(302)
      expect(errorCodeOf(response)).toBe('unknown_provider')
    })

    it('redirects with not_authenticated for a link flow with no session', async () => {
      const handler = new OAuthHandler(
        authorizeEvent({ provider: 'mock', flow: 'link' }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('not_authenticated')
    })

    it('redirects with flow_not_enabled when signup is disabled', async () => {
      const handler = new OAuthHandler(
        authorizeEvent({ provider: 'mock', flow: 'signup' }),
        {} as any,
        {
          ...baseOptions,
          providers: { mock: mockStrategy() },
          signup: { enabled: false },
        },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('flow_not_enabled')
    })

    it('302s to the authorization URL and sets a transaction cookie', async () => {
      const handler = new OAuthHandler(
        authorizeEvent({ provider: 'mock' }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(302)
      expect(locationOf(response)).toBe(
        'https://provider.example.com/authorize',
      )
      const cookies = setCookiesOf(response)
      expect(cookies.some((c) => c.startsWith('oauth-transaction='))).toBe(true)
    })
  })

  describe('callback: invalid_state', () => {
    it('redirects with invalid_state when there is no transaction cookie', async () => {
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'xyz' },
        }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('invalid_state')
    })

    it('redirects with invalid_state when state does not match the transaction cookie', async () => {
      const cookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'login',
      })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'wrong-state' },
          cookie,
        }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('invalid_state')
    })

    it('redirects with provider_error when the provider reports an error', async () => {
      const cookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'login',
      })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { error: 'access_denied', state: 'test-state' },
          cookie,
        }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('provider_error')
    })
  })

  describe('callback: login', () => {
    it('redirects with unknown_identity when no identity matches', async () => {
      const cookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'login',
      })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie,
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({ profile: { providerUserId: 'no-such-id' } }),
          },
        },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('unknown_identity')
    })

    it('logs the user in when the identity exists', async () => {
      const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
      db.oAuth.create({
        data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
      })

      const cookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'login',
      })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie,
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({ profile: { providerUserId: 'known-id' } }),
          },
        },
      )

      const response = await handler.invoke()

      expect(locationOf(response)).toBe('/dashboard')
      const session = decryptedSessionFrom(response)
      expect(session?.id).toBe(user.id)
      // The transaction cookie must be cleared on a successful callback.
      expect(
        setCookiesOf(response).some((c) => c.startsWith('oauth-transaction=;')),
      ).toBe(true)
    })
  })

  describe('callback: signup', () => {
    it('redirects with email_in_use when the email matches an existing account', async () => {
      db.user.create({ data: { email: 'taken@example.com' } })

      const cookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'signup',
      })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie,
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({
              profile: { providerUserId: 'new-id', email: 'taken@example.com' },
            }),
          },
        },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('email_in_use')
    })

    it('creates the user and identity, then logs in', async () => {
      const cookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'signup',
      })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie,
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({
              profile: {
                providerUserId: 'brand-new-id',
                email: 'new@example.com',
                username: 'New User',
              },
            }),
          },
        },
      )

      const response = await handler.invoke()

      expect(locationOf(response)).toBe('/welcome')
      expect(db.user.records).toHaveLength(1)
      expect(db.user.records[0].email).toBe('new@example.com')
      expect(db.oAuth.records).toHaveLength(1)
      expect(db.oAuth.records[0].providerUserId).toBe('brand-new-id')
    })
  })

  describe('callback: link', () => {
    it('redirects with not_authenticated when there is no dbAuth session', async () => {
      const cookie = transactionCookieHeader({ provider: 'mock', flow: 'link' })
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie,
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({ profile: { providerUserId: 'x' } }),
          },
        },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('not_authenticated')
    })

    it('redirects with identity_in_use when the identity is linked to a different account', async () => {
      const owner = db.user.create({ data: { email: 'owner@example.com' } })
      const other = db.user.create({ data: { email: 'other@example.com' } })
      db.oAuth.create({
        data: {
          provider: 'mock',
          providerUserId: 'taken-id',
          userId: owner.id,
        },
      })

      const txnCookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'link',
      })
      const sessionCookie = sessionCookieHeaderFor(other)
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie: cookieHeader(txnCookie, sessionCookie),
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({ profile: { providerUserId: 'taken-id' } }),
          },
        },
      )

      const response = await handler.invoke()

      expect(errorCodeOf(response)).toBe('identity_in_use')
    })

    it('links the identity to the current session user', async () => {
      const user = db.user.create({ data: { email: 'me@example.com' } })

      const txnCookie = transactionCookieHeader({
        provider: 'mock',
        flow: 'link',
      })
      const sessionCookie = sessionCookieHeaderFor(user)
      const handler = new OAuthHandler(
        callbackEvent({
          provider: 'mock',
          query: { code: 'abc', state: 'test-state' },
          cookie: cookieHeader(txnCookie, sessionCookie),
        }),
        {} as any,
        {
          ...baseOptions,
          providers: {
            mock: mockStrategy({ profile: { providerUserId: 'new-link-id' } }),
          },
        },
      )

      const response = await handler.invoke()

      expect(locationOf(response)).toBe('/account')
      expect(db.oAuth.records).toHaveLength(1)
      expect(db.oAuth.records[0].userId).toBe(user.id)
    })
  })

  describe('unlink', () => {
    it('returns 403 forbidden when the x-oauth-action header is missing', async () => {
      const user = db.user.create({ data: { email: 'me@example.com' } })
      db.oAuth.create({
        data: { provider: 'mock', providerUserId: 'only-id', userId: user.id },
      })

      const handler = new OAuthHandler(
        unlinkEvent({
          provider: 'mock',
          cookie: sessionCookieHeaderFor(user),
          withOAuthAction: false,
        }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(403)
      expect(JSON.parse(response.body).error).toBe('forbidden')
      expect(db.oAuth.records).toHaveLength(1)
    })

    it('returns 401 when there is no dbAuth session', async () => {
      const handler = new OAuthHandler(
        unlinkEvent({ provider: 'mock' }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(401)
      expect(JSON.parse(response.body).error).toBe('not_authenticated')
    })

    it('refuses to unlink the last identity from a passwordless account', async () => {
      const user = db.user.create({ data: { email: 'me@example.com' } })
      db.oAuth.create({
        data: { provider: 'mock', providerUserId: 'only-id', userId: user.id },
      })

      const handler = new OAuthHandler(
        unlinkEvent({ provider: 'mock', cookie: sessionCookieHeaderFor(user) }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.body).error).toBe(
        'cannot_unlink_last_identity',
      )
      expect(db.oAuth.records).toHaveLength(1)
    })

    it('unlinks when the account has a password set', async () => {
      const user = db.user.create({
        data: { email: 'me@example.com', hashedPassword: 'hashed' },
      })
      db.oAuth.create({
        data: { provider: 'mock', providerUserId: 'only-id', userId: user.id },
      })

      const handler = new OAuthHandler(
        unlinkEvent({ provider: 'mock', cookie: sessionCookieHeaderFor(user) }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body).ok).toBe(true)
      expect(db.oAuth.records).toHaveLength(0)
    })

    it('unlinks a non-last identity even without a password', async () => {
      const user = db.user.create({ data: { email: 'me@example.com' } })
      db.oAuth.create({
        data: { provider: 'mock', providerUserId: 'id-1', userId: user.id },
      })
      db.oAuth.create({
        data: { provider: 'other', providerUserId: 'id-2', userId: user.id },
      })

      const handler = new OAuthHandler(
        unlinkEvent({ provider: 'mock', cookie: sessionCookieHeaderFor(user) }),
        {} as any,
        {
          ...baseOptions,
          providers: { mock: mockStrategy(), other: mockStrategy() },
        },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(200)
      expect(db.oAuth.records).toHaveLength(1)
      expect(db.oAuth.records[0].provider).toBe('other')
    })

    it('returns 404 when no identity exists for the provider', async () => {
      const user = db.user.create({ data: { email: 'me@example.com' } })

      const handler = new OAuthHandler(
        unlinkEvent({ provider: 'mock', cookie: sessionCookieHeaderFor(user) }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(404)
      expect(JSON.parse(response.body).error).toBe('unknown_identity')
    })

    it('restores the identity when a concurrent unlink already removed the account to zero identities (TOCTOU race)', async () => {
      const user = db.user.create({ data: { email: 'me@example.com' } })
      const identity = db.oAuth.create({
        data: { provider: 'mock', providerUserId: 'only-id', userId: user.id },
      })

      const handler = new OAuthHandler(
        unlinkEvent({ provider: 'mock', cookie: sessionCookieHeaderFor(user) }),
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      // Simulates the race: the pre-delete guard's count check observes two
      // identities (as if a second identity still existed), so it passes,
      // but the store has really only ever had one — the same as if a
      // concurrent unlink request had already removed the other one by the
      // time this request's delete runs.
      const findManySpy = vi
        .spyOn(db.oAuth, 'findMany')
        .mockReturnValueOnce([
          identity,
          { ...identity, id: identity.id + 1, provider: 'other' },
        ])

      const response = await handler.invoke()

      findManySpy.mockRestore()

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.body).error).toBe(
        'cannot_unlink_last_identity',
      )
      expect(db.oAuth.records).toHaveLength(1)
      expect(db.oAuth.records[0].provider).toBe('mock')
      expect(db.oAuth.records[0].providerUserId).toBe('only-id')
    })
  })

  describe('unrecognized routes', () => {
    it('returns 404 for a path outside the OAuth base path', async () => {
      const handler = new OAuthHandler(
        {
          httpMethod: 'GET',
          path: '/auth/login',
          headers: {},
          queryStringParameters: {},
          body: null,
          isBase64Encoded: false,
        },
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(404)
    })

    it('returns 404 for the wrong HTTP verb on authorize', async () => {
      const handler = new OAuthHandler(
        {
          httpMethod: 'POST',
          path: '/auth/oauth/mock/authorize',
          headers: {},
          queryStringParameters: {},
          body: null,
          isBase64Encoded: false,
        },
        {} as any,
        { ...baseOptions, providers: { mock: mockStrategy() } },
      )

      const response = await handler.invoke()

      expect(response.statusCode).toBe(404)
    })
  })
})
