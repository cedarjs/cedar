import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
// `oauth4webapi` is the peer dependency every strategy (built-in or
// userland) is written against — a type-only import here, the same way the
// package's own strategies use it.
import type { AuthorizationServer, Client } from 'oauth4webapi'
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
} from 'vitest'

import { OAuthHandler } from '../OAuthHandler'
import { createTransactionCookieString } from '../transactionCookie'
import type { OAuthTransactionData } from '../transactionCookie'
import type {
  OAuthAuthorizationContext,
  OAuthCallbackContext,
  OAuthHandlerOptions,
  OAuthStrategy,
  OAuthUserInfo,
} from '../types'

import { DbMock } from './mockDb'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

const AUTHORIZATION_ENDPOINT = 'https://www.facebook.com/v19.0/dialog/oauth'
const TOKEN_ENDPOINT = 'https://graph.facebook.com/v19.0/oauth/access_token'
const PROFILE_ENDPOINT = 'https://graph.facebook.com/v19.0/me'

/**
 * The worked example the implementation plan calls out for a
 * custom-strategy, non-OIDC "OAuth2 + separate userinfo endpoint" provider:
 * the same shape as the built-in GitHub strategy, but written entirely as a
 * userland strategy against the public `OAuthStrategy` interface (no
 * package-internal imports).
 *
 * The frozen quirk under test: Facebook's Graph API profile response omits
 * the `email` field entirely (not `email: null`) whenever the app didn't
 * request it, the field wasn't granted, or the account has no email on
 * file — never depend on it being present.
 */
function facebookLikeStrategy(credentials: {
  clientId: string
  clientSecret: string
  redirectUri: string
}): OAuthStrategy {
  return {
    name: 'Facebook (worked example)',
    redirectUri: credentials.redirectUri,
    usesOidc: false,

    getAuthorizationUrl(ctx: OAuthAuthorizationContext): URL {
      const url = new URL(AUTHORIZATION_ENDPOINT)
      url.searchParams.set('client_id', credentials.clientId)
      url.searchParams.set('redirect_uri', ctx.redirectUri)
      url.searchParams.set('scope', 'email public_profile')
      url.searchParams.set('state', ctx.state)
      url.searchParams.set('code_challenge', ctx.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return url
    },

    async handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo> {
      const oauth = await import('oauth4webapi')

      const as: AuthorizationServer = {
        issuer: 'https://www.facebook.com',
        token_endpoint: TOKEN_ENDPOINT,
      }
      const client: Client = { client_id: credentials.clientId }
      const clientAuth = oauth.ClientSecretPost(credentials.clientSecret)

      const rawParams = { ...ctx.query, ...ctx.form }
      const params = oauth.validateAuthResponse(
        as,
        client,
        new URLSearchParams(rawParams),
        ctx.state,
      )

      const response = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        clientAuth,
        params,
        ctx.redirectUri,
        ctx.codeVerifier,
      )

      const result = await oauth.processAuthorizationCodeResponse(
        as,
        client,
        response,
        { requireIdToken: false },
      )

      const profileResponse = await fetch(
        `${PROFILE_ENDPOINT}?fields=id,name,email`,
        {
          headers: { Authorization: `Bearer ${result.access_token}` },
        },
      )
      if (!profileResponse.ok) {
        throw new Error(
          `Facebook Graph API request failed with status ${profileResponse.status}`,
        )
      }
      const profile = (await profileResponse.json()) as {
        id: string
        name?: string
        email?: string
      }

      return {
        // Facebook's numeric `id` is the only stable field — lookup keys on
        // this, never on `email` (which may be entirely absent).
        providerUserId: profile.id,
        email: profile.email,
        username: profile.name,
        raw: profile,
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

function callbackEvent({
  provider,
  cookie,
}: {
  provider: string
  cookie?: string
}) {
  return {
    httpMethod: 'GET',
    path: `/auth/oauth/${provider}/callback`,
    headers: cookie ? { cookie } : {},
    queryStringParameters: { code: 'the-code', state: 'test-state' },
    body: null,
    isBase64Encoded: false,
  } as any
}

function locationOf(response: any): string {
  return response.headers.location ?? response.headers.Location
}

function tokenAndProfileHandlers(profile: Record<string, unknown>) {
  return [
    http.post(TOKEN_ENDPOINT, () =>
      HttpResponse.json({
        access_token: 'fb-test-token',
        token_type: 'bearer',
      }),
    ),
    http.get(PROFILE_ENDPOINT, ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer fb-test-token')
      return HttpResponse.json(profile)
    }),
  ]
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
      facebook: facebookLikeStrategy({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'https://example.com/auth/oauth/facebook/callback',
      }),
    },
    redirects: {
      afterLogin: '/dashboard',
      afterSignup: '/welcome',
      error: '/auth/error',
    },
    signup: {
      // Tolerates a missing email, the way an app opting into a Facebook
      // (or any email-optional) strategy must.
      handler: ({ profile }) =>
        db.user.create({
          data: { email: profile.email ?? null, name: profile.username },
        }),
    },
    sessionExpires: 60 * 60,
  }
}

describe('Facebook-shaped custom strategy (OAuth2 + userinfo, no OIDC)', () => {
  it('signs up successfully when the Graph API profile has no email field at all', async () => {
    server.use(
      ...tokenAndProfileHandlers({
        id: '10152798694183358',
        name: 'Ada Lovelace',
        // No `email` key present — the frozen Facebook quirk, distinct from
        // GitHub's explicit `email: null`.
      }),
    )

    const db = new DbMock(['user', 'oAuth'])
    const cookie = transactionCookieHeader({
      provider: 'facebook',
      flow: 'signup',
    })
    const handler = new OAuthHandler(
      callbackEvent({ provider: 'facebook', cookie }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(locationOf(response)).toBe('/welcome')
    expect(db.user.records).toHaveLength(1)
    expect(db.user.records[0].email).toBeNull()
    expect(db.user.records[0].name).toBe('Ada Lovelace')

    expect(db.oAuth.records).toHaveLength(1)
    expect(db.oAuth.records[0].providerUserId).toBe('10152798694183358')
    // The identity field for the provider email is never written when the
    // profile didn't have one.
    expect(db.oAuth.records[0].providerEmail).toBeUndefined()
  })

  it('logs the same user back in on a subsequent visit, keyed only on providerUserId', async () => {
    server.use(
      ...tokenAndProfileHandlers({
        id: '10152798694183358',
        name: 'Ada Lovelace',
      }),
    )

    const db = new DbMock(['user', 'oAuth'])
    const user = db.user.create({ data: { email: null, name: 'Ada Lovelace' } })
    db.oAuth.create({
      data: {
        provider: 'facebook',
        providerUserId: '10152798694183358',
        userId: user.id,
      },
    })

    const cookie = transactionCookieHeader({
      provider: 'facebook',
      flow: 'login',
    })
    const handler = new OAuthHandler(
      callbackEvent({ provider: 'facebook', cookie }),
      {} as any,
      baseOptions(db),
    )

    const response = await handler.invoke()

    expect(locationOf(response)).toBe('/dashboard')
    // Still exactly one user/identity — the login found the existing
    // account by providerUserId, with no email to match against at all.
    expect(db.user.records).toHaveLength(1)
    expect(db.oAuth.records).toHaveLength(1)
  })
})
