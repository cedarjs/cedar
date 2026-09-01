import type { APIGatewayProxyEvent } from 'aws-lambda'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { decryptSession, getSession } from '@cedarjs/auth-dbauth-api'

import { OAuthHandler } from '../OAuthHandler'
import { createTransactionCookieString } from '../transactionCookie'
import type { OAuthTransactionData } from '../transactionCookie'
import type { OAuthHandlerOptions, OAuthStrategy } from '../types'

import { DbMock } from './mockDb'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'
const SECRET_MESSAGE = 'connection refused to postgres://internal-db-host:5432'

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
  cookie,
}: {
  provider: string
  cookie?: string
}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: `/auth/oauth/${provider}/callback`,
    headers: cookie ? { cookie } : {},
    queryStringParameters: { code: 'abc', state: 'test-state' },
    body: null,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent
}

function locationOf(response: any): string {
  return response.headers.location ?? response.headers.Location
}

function setCookiesOf(response: any): string[] {
  const value =
    response.headers['set-cookie'] ?? response.multiValueHeaders?.['Set-Cookie']
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function decryptedSessionFrom(
  response: any,
): [Record<string, unknown>, string] {
  const sessionCookie = setCookiesOf(response).find((c) =>
    c.startsWith('session='),
  )
  if (!sessionCookie) {
    throw new Error('expected a session cookie to be set')
  }
  const value = getSession(sessionCookie, undefined)
  const [session, csrf] = decryptSession(value)
  return [session, csrf]
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

describe('OAuthHandler: error-redirect hygiene', () => {
  it('carries only error=server_error on an internal failure, never the exception text', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Simulates an internal failure (e.g. a database accessor throwing)
    // partway through the login flow, after the identity lookup has already
    // succeeded.
    const throwingUserAccessor = {
      findFirst: () => {
        throw new Error(SECRET_MESSAGE)
      },
    }

    const options: OAuthHandlerOptions<any> = {
      ...baseOptions(db),
      db: { user: throwingUserAccessor, oAuth: db.oAuth } as any,
    }

    const cookie = transactionCookieHeader({ provider: 'mock', flow: 'login' })
    const handler = new OAuthHandler(
      callbackEvent({ provider: 'mock', cookie }),
      {} as any,
      options,
    )

    const response = await handler.invoke()

    const location = locationOf(response)
    const url = new URL(location, 'https://example.com')

    expect(url.searchParams.get('error')).toBe('server_error')
    expect(location).not.toContain(SECRET_MESSAGE)
    expect(location).not.toContain('postgres://')
    expect(location).not.toContain('Error')
    expect(response.body ?? '').not.toContain(SECRET_MESSAGE)

    // The real message is only for server-side logs.
    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (arg) => typeof arg === 'string' && arg.includes(SECRET_MESSAGE),
        ),
      ),
    ).toBe(true)

    consoleError.mockRestore()
  })
})

describe('OAuthHandler: session correctness', () => {
  it('sets both the auth-provider cookie and a session cookie that decrypts to the data;csrf structure', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
    })

    const cookie = transactionCookieHeader({ provider: 'mock', flow: 'login' })
    const handler = new OAuthHandler(
      callbackEvent({ provider: 'mock', cookie }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    const cookies = setCookiesOf(response)
    expect(cookies.some((c) => c.startsWith('auth-provider=dbAuth'))).toBe(true)

    const [session, csrfToken] = decryptedSessionFrom(response)
    expect(session.id).toBe(user.id)
    expect(typeof csrfToken).toBe('string')
    expect(csrfToken.length).toBeGreaterThan(0)
  })
})
