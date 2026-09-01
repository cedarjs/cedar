import { Events, OAuth2Server } from 'oauth2-mock-server'
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'

import { decryptSession, getSession } from '@cedarjs/auth-dbauth-api'

import { OAuthHandler } from '../OAuthHandler'
import { createOidcStrategy } from '../oidc'
import type { OAuthHandlerOptions } from '../types'

import { DbMock } from './mockDb'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'

let server: OAuth2Server
let issuer: string

beforeAll(async () => {
  server = new OAuth2Server()
  await server.issuer.keys.generate('RS256')
  await server.start(0, 'localhost')
  issuer = server.issuer.url as string
})

afterAll(async () => {
  await server.stop()
})

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

/**
 * Drives a full authorization-code + PKCE round trip against the in-process
 * mock IdP: hits `authorize()` to get the redirect + transaction cookie,
 * follows the redirect to the mock server's real `/authorize` endpoint to
 * get a real code, then hits `callback()` with it — exercising discovery,
 * PKCE, the token exchange, and id_token verification for real.
 */
async function runOidcFlow({
  handlerOptions,
  flow,
  claims,
}: {
  handlerOptions: OAuthHandlerOptions<any>
  flow: 'login' | 'signup'
  claims: Record<string, unknown>
}) {
  // A single `/token` call signs more than one JWT (the access token and
  // the id_token), so a `.once()` listener only catches the first of them —
  // use a persistent listener for the duration of this flow instead, and
  // tear it down once we're done so it doesn't leak into other tests.
  const beforeTokenSigning = (token: { payload: Record<string, unknown> }) => {
    Object.assign(token.payload, claims)
  }
  server.service.on(Events.BeforeTokenSigning, beforeTokenSigning)

  // Everything between registering the listener above and the callback
  // invocation below can throw (the fetch, the status/redirect assertions,
  // handler construction) -- the `finally` needs to wrap all of it, not
  // just the final `invoke()` call, or a failure earlier in the flow would
  // leak the listener into later tests.
  try {
    const authorizeHandler = new OAuthHandler(
      {
        httpMethod: 'GET',
        path: '/auth/oauth/google/authorize',
        headers: {},
        queryStringParameters: { flow },
        body: null,
        isBase64Encoded: false,
      },
      {} as any,
      handlerOptions,
    )

    const authorizeResponse = await authorizeHandler.invoke()
    const authorizationUrl = (authorizeResponse.headers as any).location
    const transactionSetCookie = (
      (authorizeResponse.headers['set-cookie'] as string[] | undefined) ?? []
    ).find((c) => c.startsWith('oauth-transaction='))!
    const transactionCookie = transactionSetCookie.split(';')[0]

    const authorizeUrlResponse = await fetch(authorizationUrl, {
      redirect: 'manual',
    })
    expect(authorizeUrlResponse.status).toBeGreaterThanOrEqual(300)
    expect(authorizeUrlResponse.status).toBeLessThan(400)
    const redirectLocation = new URL(
      authorizeUrlResponse.headers.get('location')!,
    )

    const callbackHandler = new OAuthHandler(
      {
        httpMethod: 'GET',
        path: '/auth/oauth/google/callback',
        headers: { cookie: transactionCookie },
        queryStringParameters: Object.fromEntries(
          redirectLocation.searchParams.entries(),
        ),
        body: null,
        isBase64Encoded: false,
      },
      {} as any,
      handlerOptions,
    )

    return await callbackHandler.invoke()
  } finally {
    server.service.off(Events.BeforeTokenSigning, beforeTokenSigning)
  }
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
    providers: {
      google: createOidcStrategy(
        { name: 'Google', issuer, scope: 'openid email profile' },
        {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          redirectUri: 'https://example.com/auth/oauth/google/callback',
          allowInsecureRequests: true,
        },
      ),
    },
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

describe('OAuthHandler + createOidcStrategy against a real OIDC provider', () => {
  it('logs an existing user in end to end', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: 'rob@cedarjs.com' } })
    db.oAuth.create({
      data: {
        provider: 'google',
        providerUserId: 'google-sub-123',
        userId: user.id,
      },
    })

    const response = await runOidcFlow({
      handlerOptions: baseOptions(db),
      flow: 'login',
      claims: {
        sub: 'google-sub-123',
        email: 'rob@cedarjs.com',
        email_verified: true,
      },
    })

    expect((response.headers as any).location).toBe('/dashboard')

    const setCookies = (response.headers['set-cookie'] as string[]) ?? []
    const sessionCookie = setCookies.find((c) => c.startsWith('session='))
    expect(sessionCookie).toBeTruthy()

    const [session] = decryptSession(getSession(sessionCookie, undefined))
    expect(session.id).toBe(user.id)
  })

  it('signs a new user up end to end', async () => {
    const db = new DbMock(['user', 'oAuth'])

    const response = await runOidcFlow({
      handlerOptions: baseOptions(db),
      flow: 'signup',
      claims: {
        sub: 'google-sub-456',
        email: 'new-via-google@cedarjs.com',
        email_verified: true,
      },
    })

    expect((response.headers as any).location).toBe('/welcome')
    expect(db.user.records).toHaveLength(1)
    expect(db.user.records[0].email).toBe('new-via-google@cedarjs.com')
    expect(db.oAuth.records).toHaveLength(1)
    expect(db.oAuth.records[0].providerUserId).toBe('google-sub-456')
  })

  it('does not pass through an unverified email claim', async () => {
    const db = new DbMock(['user', 'oAuth'])

    const response = await runOidcFlow({
      handlerOptions: baseOptions(db),
      flow: 'signup',
      claims: {
        sub: 'google-sub-789',
        email: 'unverified@cedarjs.com',
        email_verified: false,
      },
    })

    expect((response.headers as any).location).toBe('/welcome')
    expect(db.user.records).toHaveLength(1)
    // The signup handler in `baseOptions` reads `profile.email` -- an
    // unverified claim must come through as `undefined`, not the address
    // itself, so it can't seed a username or a duplicate-account check.
    expect(db.user.records[0].email).toBeUndefined()
  })
})

describe('createOidcStrategy discovery retry', () => {
  it('retries discovery after a transient failure instead of caching the rejection forever', async () => {
    const strategy = createOidcStrategy(
      { name: 'Google', issuer, scope: 'openid email profile' },
      {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/auth/oauth/google/callback',
        allowInsecureRequests: true,
      },
    )

    const authCtx = {
      redirectUri: 'https://example.com/auth/oauth/google/callback',
      state: 'test-state',
      codeChallenge: 'test-code-challenge',
    }

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('simulated discovery failure'))

    await expect(strategy.getAuthorizationUrl(authCtx)).rejects.toThrow(
      'simulated discovery failure',
    )

    fetchSpy.mockRestore()

    // A cached rejection would make every subsequent call fail the same
    // way; this second attempt must succeed once the transient failure is
    // gone.
    const url = await strategy.getAuthorizationUrl(authCtx)
    expect(url).toBeInstanceOf(URL)
  })
})
