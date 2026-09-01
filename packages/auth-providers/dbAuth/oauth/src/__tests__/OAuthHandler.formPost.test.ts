import type { APIGatewayProxyEvent } from 'aws-lambda'
import { describe, it, expect, beforeEach } from 'vitest'

import { decryptSession, getSession } from '@cedarjs/auth-dbauth-api'

import { OAuthHandler } from '../OAuthHandler'
import { createTransactionCookieString } from '../transactionCookie'
import type { OAuthTransactionData } from '../transactionCookie'
import type {
  OAuthCallbackContext,
  OAuthHandlerOptions,
  OAuthStrategy,
} from '../types'

import { DbMock } from './mockDb'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

/**
 * A strategy that only ever reads `ctx.form` — used to prove the handler
 * actually threads the parsed form body through to the strategy on a
 * `form_post` callback, rather than only looking at `ctx.query`.
 */
function formOnlyStrategy(): OAuthStrategy {
  return {
    name: 'Mock',
    redirectUri: 'https://example.com/auth/oauth/mock/callback',
    usesOidc: false,
    getAuthorizationUrl: () =>
      new URL('https://provider.example.com/authorize'),
    handleCallback: async (ctx: OAuthCallbackContext) => {
      if (Object.keys(ctx.query).length > 0) {
        throw new Error(
          'expected an empty query on a form_post callback, got: ' +
            JSON.stringify(ctx.query),
        )
      }
      return {
        providerUserId: ctx.form.providerUserId,
        email: ctx.form.email,
      }
    },
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

function formPostCallbackEvent({
  provider,
  cookie,
  form,
}: {
  provider: string
  cookie?: string
  form: Record<string, string>
}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: `/auth/oauth/${provider}/callback`,
    headers: {
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    queryStringParameters: {},
    body: new URLSearchParams(form).toString(),
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
    providers: { mock: formOnlyStrategy() },
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

describe('OAuthHandler callback: form_post', () => {
  it('completes a login when the callback arrives as a POST with a form-urlencoded body, code and state in the form (not the query)', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
    })

    const cookie = transactionCookieHeader({ provider: 'mock', flow: 'login' })
    const handler = new OAuthHandler(
      formPostCallbackEvent({
        provider: 'mock',
        cookie,
        form: {
          code: 'the-code',
          state: 'test-state',
          providerUserId: 'known-id',
        },
      }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(locationOf(response)).toBe('/dashboard')
    const sessionCookie = setCookiesOf(response).find((c) =>
      c.startsWith('session='),
    )
    expect(sessionCookie).toBeTruthy()
    const [session] = decryptSession(getSession(sessionCookie, undefined))
    expect(session.id).toBe(user.id)
  })

  it('completes a signup when the callback arrives as a POST with a form-urlencoded body', async () => {
    const db = new DbMock(['user', 'oAuth'])

    const cookie = transactionCookieHeader({ provider: 'mock', flow: 'signup' })
    const handler = new OAuthHandler(
      formPostCallbackEvent({
        provider: 'mock',
        cookie,
        form: {
          code: 'the-code',
          state: 'test-state',
          providerUserId: 'brand-new-id',
          email: 'new-via-form-post@example.com',
        },
      }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(locationOf(response)).toBe('/welcome')
    expect(db.user.records).toHaveLength(1)
    expect(db.user.records[0].email).toBe('new-via-form-post@example.com')
    expect(db.oAuth.records[0].providerUserId).toBe('brand-new-id')
  })

  it('rejects a form_post callback with a mismatched state the same way a GET callback would', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const cookie = transactionCookieHeader({
      provider: 'mock',
      flow: 'login',
      state: 'correct-state',
    })

    const handler = new OAuthHandler(
      formPostCallbackEvent({
        provider: 'mock',
        cookie,
        form: { code: 'the-code', state: 'wrong-state' },
      }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    const location = new URL(locationOf(response), 'https://example.com')
    expect(location.searchParams.get('error')).toBe('invalid_state')
  })
})

describe('OAuthHandler transaction cookie: independent cookie config for cross-site form_post providers', () => {
  function optionsWithSplitCookieConfig(db: DbMock): OAuthHandlerOptions<any> {
    return {
      ...baseOptions(db),
      cookie: { attributes: { SameSite: 'Lax', Secure: true } },
      transactionCookie: { attributes: { SameSite: 'None', Secure: true } },
    }
  }

  it("sets `SameSite=None` (from `transactionCookie`) on the transaction cookie `authorize` writes, not `cookie`'s `SameSite=Lax`", async () => {
    const db = new DbMock(['user', 'oAuth'])
    const authorizeHandler = new OAuthHandler(
      {
        httpMethod: 'GET',
        path: '/auth/oauth/mock/authorize',
        headers: {},
        queryStringParameters: { flow: 'login' },
        body: null,
        isBase64Encoded: false,
      },
      {} as any,
      optionsWithSplitCookieConfig(db),
    )

    const response = await authorizeHandler.invoke()
    const transactionSetCookie = setCookiesOf(response).find((c) =>
      c.startsWith('oauth-transaction='),
    )!

    expect(transactionSetCookie).toContain('SameSite=None')
    expect(transactionSetCookie).not.toContain('SameSite=Lax')
  })

  it("sets `SameSite=Lax` (from `cookie`) on the session cookie a callback mints, unaffected by `transactionCookie`'s `SameSite=None`", async () => {
    const db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: { provider: 'mock', providerUserId: 'known-id', userId: user.id },
    })

    const cookie = transactionCookieHeader({ provider: 'mock', flow: 'login' })
    const callbackHandler = new OAuthHandler(
      formPostCallbackEvent({
        provider: 'mock',
        cookie,
        form: {
          code: 'the-code',
          state: 'test-state',
          providerUserId: 'known-id',
        },
      }),
      {} as any,
      optionsWithSplitCookieConfig(db),
    )

    const response = await callbackHandler.invoke()
    const sessionCookie = setCookiesOf(response).find((c) =>
      c.startsWith('session='),
    )!

    expect(sessionCookie).toContain('SameSite=Lax')
    expect(sessionCookie).not.toContain('SameSite=None')
  })
})
