import { randomBytes } from 'node:crypto'

import { Events, OAuth2Server } from 'oauth2-mock-server'
// `oauth4webapi` is the peer dependency every strategy (built-in or
// userland) is written against — a type-only import here, exactly like the
// package's own strategies use it.
import type { Client } from 'oauth4webapi'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { decryptSession, getSession } from '@cedarjs/auth-dbauth-api'

// Deliberately imported only from the package's public entry point — this
// test's whole point is that the Apple-shaped strategy below needs nothing
// else from the package.
import type {
  OAuthAuthorizationContext,
  OAuthCallbackContext,
  OAuthHandlerOptions,
  OAuthStrategy,
  OAuthUserInfo,
} from '../index'
import { OAuthHandler } from '../index'

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
 * Fabricates a fresh, ES256-client-secret-JWT-shaped string on every call —
 * the way Apple's `client_secret` (a JWT signed with the app's private key,
 * carrying a short expiry) has to be minted per token request rather than
 * read out of a static config value. The mock token endpoint below doesn't
 * verify the signature, so a random signature segment is enough to prove
 * this strategy computes client authentication dynamically; a real
 * implementation would sign the payload with `jose`.
 */
function computeAppleClientSecret(clientId: string, teamId: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  const now = Math.floor(Date.now() / 1000)
  const header = encode({ alg: 'ES256', kid: 'test-key-id' })
  const payload = encode({
    iss: teamId,
    sub: clientId,
    aud: 'https://appleid.apple.com',
    iat: now,
    exp: now + 300,
    nonce: randomBytes(8).toString('hex'),
  })
  const signature = randomBytes(32).toString('base64url')

  return `${header}.${payload}.${signature}`
}

/**
 * Apple's one-time `user` form field: a JSON string carrying the user's name
 * (and, on some flows, email) that Apple sends only on the very first
 * authorization, as a `form_post` field alongside `code`/`state`/`id_token`
 * — never again on subsequent logins, and never in the id_token itself.
 */
function parseAppleUserField(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as {
      name?: { firstName?: string; lastName?: string }
    }
    const fullName = [parsed.name?.firstName, parsed.name?.lastName]
      .filter(Boolean)
      .join(' ')
    return fullName || undefined
  } catch {
    return undefined
  }
}

/**
 * An Apple-shaped strategy, written entirely against the public
 * `OAuthStrategy` interface (no import from anywhere in this package other
 * than `../index`). It exercises every part of the interface the plan's
 * Apple acceptance criterion calls out: a dynamically computed client
 * secret, raw access to `ctx.form` for the one-time `user` field, and a
 * cross-site-style `form_post` callback.
 */
function appleLikeStrategy({
  clientId,
  teamId,
  redirectUri,
}: {
  clientId: string
  teamId: string
  redirectUri: string
}): OAuthStrategy {
  let discoveryPromise: ReturnType<typeof discover> | undefined

  async function discover() {
    const oauth = await import('oauth4webapi')
    const issuerUrl = new URL(issuer)
    const response = await oauth.discoveryRequest(issuerUrl, {
      [oauth.allowInsecureRequests]: true,
    })
    const as = await oauth.processDiscoveryResponse(issuerUrl, response)
    return { oauth, as }
  }

  function getDiscovery() {
    discoveryPromise ??= discover()
    return discoveryPromise
  }

  return {
    name: 'Apple (test double)',
    redirectUri,
    usesOidc: true,

    async getAuthorizationUrl(ctx: OAuthAuthorizationContext): Promise<URL> {
      const { as } = await getDiscovery()
      if (!as.authorization_endpoint) {
        throw new Error('mock IdP has no authorization_endpoint')
      }

      const url = new URL(as.authorization_endpoint)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', ctx.redirectUri)
      url.searchParams.set('response_type', 'code')
      // Real Apple requires `response_mode=form_post` whenever scopes are
      // requested — recorded here even though the mock IdP's `/authorize`
      // always redirects with a GET; the cross-site POST is reconstructed
      // by the test below from the code/state it returns.
      url.searchParams.set('response_mode', 'form_post')
      url.searchParams.set('scope', 'name email')
      url.searchParams.set('state', ctx.state)
      url.searchParams.set('code_challenge', ctx.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      if (ctx.nonce) {
        url.searchParams.set('nonce', ctx.nonce)
      }

      return url
    },

    async handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo> {
      const { oauth, as } = await getDiscovery()
      const client: Client = { client_id: clientId }

      // Computed fresh for this callback, not read from a static field on
      // `credentials` — proving the interface doesn't force a static
      // client secret.
      const clientAuth = oauth.ClientSecretPost(
        computeAppleClientSecret(clientId, teamId),
      )

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
        { [oauth.allowInsecureRequests]: true },
      )

      const result = await oauth.processAuthorizationCodeResponse(
        as,
        client,
        response,
        {
          expectedNonce: ctx.nonce ?? oauth.expectNoNonce,
          requireIdToken: true,
        },
      )

      const claims = oauth.getValidatedIdTokenClaims(result)
      if (!claims) {
        throw new Error('Apple test double: no id_token returned')
      }

      return {
        providerUserId: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        emailVerified:
          typeof claims.email_verified === 'boolean'
            ? claims.email_verified
            : undefined,
        // Only ever available from the raw form body, and only on this
        // first-authorization callback.
        username: parseAppleUserField(ctx.form.user),
        raw: claims,
      }
    },
  }
}

function baseOptions(
  db: DbMock,
  clientId: string,
  teamId: string,
): OAuthHandlerOptions<any> {
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
      apple: appleLikeStrategy({
        clientId,
        teamId,
        redirectUri: 'https://example.com/auth/oauth/apple/callback',
      }),
    },
    redirects: {
      afterLogin: '/dashboard',
      afterSignup: '/welcome',
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
}

/**
 * Drives one authorization round trip against the mock IdP, then delivers
 * the callback as a cross-site-style `form_post` POST (code/state/`user` in
 * the form body, empty query) instead of the usual GET-with-query-params —
 * the shape Apple actually uses.
 */
async function runAppleFormPostFlow({
  handlerOptions,
  flow,
  claims,
  appleUserField,
}: {
  handlerOptions: OAuthHandlerOptions<any>
  flow: 'login' | 'signup'
  claims: Record<string, unknown>
  appleUserField?: Record<string, unknown>
}) {
  const beforeTokenSigning = (token: { payload: Record<string, unknown> }) => {
    Object.assign(token.payload, claims)
  }
  server.service.on(Events.BeforeTokenSigning, beforeTokenSigning)

  try {
    const authorizeHandler = new OAuthHandler(
      {
        httpMethod: 'GET',
        path: '/auth/oauth/apple/authorize',
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

    // The mock IdP always redirects via GET; extract the real code/state it
    // issued and re-deliver them as a POST form body, the way Apple's
    // browser-side form_post submission would arrive at the callback URL.
    const authorizeUrlResponse = await fetch(authorizationUrl, {
      redirect: 'manual',
    })
    const redirectLocation = new URL(
      authorizeUrlResponse.headers.get('location')!,
    )
    const code = redirectLocation.searchParams.get('code')!
    const state = redirectLocation.searchParams.get('state')!

    const formBody = new URLSearchParams({
      code,
      state,
      ...(appleUserField ? { user: JSON.stringify(appleUserField) } : {}),
    }).toString()

    const callbackHandler = new OAuthHandler(
      {
        httpMethod: 'POST',
        path: '/auth/oauth/apple/callback',
        headers: {
          cookie: transactionCookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        queryStringParameters: {},
        body: formBody,
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

describe('Apple acceptance criterion: implementable purely through the public OAuthStrategy interface', () => {
  it('signs a new user up via a cross-site form_post callback, reading the one-time `user` form field', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const options = baseOptions(db, 'apple-client-id', 'apple-team-id')

    const response = await runAppleFormPostFlow({
      handlerOptions: options,
      flow: 'signup',
      claims: {
        sub: 'apple-sub-1',
        email: 'ada@example.com',
        email_verified: true,
      },
      appleUserField: { name: { firstName: 'Ada', lastName: 'Lovelace' } },
    })

    expect((response.headers as any).location).toBe('/welcome')

    expect(db.user.records).toHaveLength(1)
    expect(db.user.records[0].email).toBe('ada@example.com')
    expect(db.user.records[0].name).toBe('Ada Lovelace')
    expect(db.oAuth.records).toHaveLength(1)
    expect(db.oAuth.records[0].providerUserId).toBe('apple-sub-1')

    const setCookies =
      (response.headers['set-cookie'] as string[] | undefined) ?? []
    const sessionCookie = setCookies.find((c) => c.startsWith('session='))
    expect(sessionCookie).toBeTruthy()
    const [session] = decryptSession(getSession(sessionCookie, undefined))
    expect(session.id).toBe(db.user.records[0].id)
  })

  it('computes a fresh client secret for every token request rather than reusing a static value', async () => {
    const db = new DbMock(['user', 'oAuth'])
    const options = baseOptions(db, 'apple-client-id', 'apple-team-id')

    const capturedClientSecrets: string[] = []
    const captureClientSecret = (
      _token: unknown,
      req: { body: Record<string, unknown> },
    ) => {
      // The mock server's `TokenRequest` type doesn't declare
      // `client_secret` (it isn't part of the fields the library models),
      // but the parsed form body still carries whatever the client actually
      // sent — this is how the test observes the strategy's real behavior.
      const clientSecret = req.body['client_secret']
      if (typeof clientSecret === 'string') {
        capturedClientSecrets.push(clientSecret)
      }
    }
    server.service.on(Events.BeforeTokenSigning, captureClientSecret)

    try {
      await runAppleFormPostFlow({
        handlerOptions: options,
        flow: 'signup',
        claims: { sub: 'apple-sub-2', email: 'grace@example.com' },
        appleUserField: { name: { firstName: 'Grace', lastName: 'Hopper' } },
      })

      await runAppleFormPostFlow({
        handlerOptions: options,
        flow: 'login',
        claims: { sub: 'apple-sub-2', email: 'grace@example.com' },
      })
    } finally {
      server.service.off(Events.BeforeTokenSigning, captureClientSecret)
    }

    // A single `/token` call signs more than one JWT (the access token and
    // the id_token), so `BeforeTokenSigning` fires more than once per token
    // request with the same client secret each time — dedupe down to one
    // value per token request before comparing across the two flows.
    const uniqueClientSecrets = [...new Set(capturedClientSecrets)]

    expect(uniqueClientSecrets).toHaveLength(2)
    // Three dot-separated segments, JWT-shaped.
    expect(uniqueClientSecrets[0].split('.')).toHaveLength(3)
    expect(uniqueClientSecrets[1].split('.')).toHaveLength(3)
    // Different on every call — not a static secret read out of config.
    expect(uniqueClientSecrets[0]).not.toBe(uniqueClientSecrets[1])
  })
})
