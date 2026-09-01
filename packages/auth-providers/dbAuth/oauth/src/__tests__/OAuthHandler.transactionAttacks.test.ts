import type { APIGatewayProxyEvent } from 'aws-lambda'
import { describe, it, expect, beforeEach } from 'vitest'

import { OAuthHandler } from '../OAuthHandler'
import { createTransactionCookieString } from '../transactionCookie'
import type { OAuthTransactionData } from '../transactionCookie'
import type { OAuthHandlerOptions, OAuthStrategy } from '../types'

import { DbMock } from './mockDb'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

function mockStrategy(providerUserId = 'known-id'): OAuthStrategy {
  return {
    name: 'Mock',
    redirectUri: 'https://example.com/auth/oauth/mock/callback',
    usesOidc: false,
    getAuthorizationUrl: () =>
      new URL('https://provider.example.com/authorize'),
    handleCallback: async () => ({ providerUserId }),
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

function callbackEvent({
  provider,
  query = {},
  cookie,
}: {
  provider: string
  query?: Record<string, string>
  cookie?: string
}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: `/auth/oauth/${provider}/callback`,
    headers: cookie ? { cookie } : {},
    queryStringParameters: query,
    body: null,
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

function transactionCookieIsCleared(response: any): boolean {
  return setCookiesOf(response).some((c) => c.startsWith('oauth-transaction=;'))
}

function baseOptions(db: DbMock): OAuthHandlerOptions<any> {
  return {
    db,
    authModelAccessor: 'user',
    oauthModelAccessor: 'oAuth',
    authFields: {
      id: 'id',
      username: 'email',
      hashedPassword: 'hashedPassword',
    },
    providers: { mock: mockStrategy('known-id') },
    redirects: {
      afterLogin: '/dashboard',
      afterSignup: '/welcome',
      error: '/auth/error',
    },
    signup: {
      handler: ({ profile }) =>
        db.user.create({ data: { email: profile.email } }),
    },
    sessionExpires: 60 * 60,
  }
}

describe('OAuthHandler callback: transaction cookie attacks', () => {
  let db: DbMock

  beforeEach(() => {
    db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
    })
  })

  it('redirects with invalid_state and clears the cookie when there is no transaction cookie at all', async () => {
    const handler = new OAuthHandler(
      callbackEvent({ provider: 'mock', query: { code: 'abc', state: 'xyz' } }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(errorCodeOf(response)).toBe('invalid_state')
    expect(transactionCookieIsCleared(response)).toBe(true)
  })

  it('redirects with invalid_state and clears the cookie when the transaction cookie is undecryptable (tampered)', async () => {
    const validCookie = transactionCookieHeader({
      provider: 'mock',
      flow: 'login',
    })
    // Corrupt the ciphertext so `decodeTransactionCookie` can't decrypt it —
    // simulates an attacker (or corruption in transit) tampering with the
    // cookie value.
    const [name, value] = validCookie.split('=')
    const tampered = `${name}=${value.slice(0, -6)}zzzzzz`

    const handler = new OAuthHandler(
      callbackEvent({
        provider: 'mock',
        query: { code: 'abc', state: 'test-state' },
        cookie: tampered,
      }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(errorCodeOf(response)).toBe('invalid_state')
    expect(transactionCookieIsCleared(response)).toBe(true)
  })

  it('redirects with invalid_state and clears the cookie when the callback state does not match the cookie state', async () => {
    const cookie = transactionCookieHeader({
      provider: 'mock',
      flow: 'login',
      state: 'correct-state',
    })

    const handler = new OAuthHandler(
      callbackEvent({
        provider: 'mock',
        query: { code: 'abc', state: 'attacker-supplied-state' },
        cookie,
      }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(errorCodeOf(response)).toBe('invalid_state')
    expect(transactionCookieIsCleared(response)).toBe(true)
  })

  it('redirects with invalid_state and clears the cookie when the transaction has expired', async () => {
    const cookie = transactionCookieHeader({
      provider: 'mock',
      flow: 'login',
      // Older than the default 10-minute transaction window.
      createdAt: Date.now() - 11 * 60 * 1000,
    })

    const handler = new OAuthHandler(
      callbackEvent({
        provider: 'mock',
        query: { code: 'abc', state: 'test-state' },
        cookie,
      }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(errorCodeOf(response)).toBe('invalid_state')
    expect(transactionCookieIsCleared(response)).toBe(true)
    // No login should have happened as a side effect of an expired transaction.
    expect(db.oAuth.records).toHaveLength(1)
  })
})

describe('OAuthHandler callback: replay protection', () => {
  let db: DbMock

  beforeEach(() => {
    db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
    })
  })

  it('cannot be replayed once the transaction cookie has been cleared client-side', async () => {
    const cookie = transactionCookieHeader({ provider: 'mock', flow: 'login' })
    const query = { code: 'abc', state: 'test-state' }
    const options = baseOptions(db)

    const firstHandler = new OAuthHandler(
      callbackEvent({ provider: 'mock', query, cookie }),
      {} as any,
      options,
    )
    const firstResponse = await firstHandler.invoke()

    expect(errorCodeOf(firstResponse)).toBeNull()
    expect(locationOf(firstResponse)).toBe('/dashboard')
    expect(transactionCookieIsCleared(firstResponse)).toBe(true)

    const userCountAfterFirstLogin = db.user.records.length
    const identityCountAfterFirstLogin = db.oAuth.records.length

    // A real browser would have dropped the transaction cookie after the
    // first response's `Set-Cookie: oauth-transaction=;` — replay the exact
    // same callback request, but without the (now-cleared) transaction
    // cookie, the way a resent/duplicated request would arrive.
    const replayHandler = new OAuthHandler(
      callbackEvent({ provider: 'mock', query }),
      {} as any,
      options,
    )
    const replayResponse = await replayHandler.invoke()

    expect(errorCodeOf(replayResponse)).toBe('invalid_state')
    // No new user, session, or identity row from the replay.
    expect(db.user.records).toHaveLength(userCountAfterFirstLogin)
    expect(db.oAuth.records).toHaveLength(identityCountAfterFirstLogin)
    expect(
      setCookiesOf(replayResponse).some((c) => c.startsWith('session=')),
    ).toBe(false)
  })
})
