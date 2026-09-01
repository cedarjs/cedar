import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { decryptSession, getSession } from '@cedarjs/auth-dbauth-api'

import { OAuthHandler } from '../OAuthHandler'
import { createOidcStrategy } from '../oidc'
import type { OAuthHandlerOptions } from '../types'

import { DbMock } from './mockDb'

/**
 * Drives the OIDC authorization-code + PKCE flow against a real Keycloak
 * server instead of `oauth2-mock-server` — see
 * `OAuthHandler.oidc.test.ts` for the equivalent test against the in-process
 * mock IdP. Keycloak's login page is plain server-rendered HTML with no
 * client-side JS required to submit it, so the whole dance (including the
 * actual username/password form post) runs headless, without a browser.
 *
 * Gated on `KEYCLOAK_BASE_URL` so the default suite (which runs without a
 * Keycloak server available) skips this file instantly. CI sets the env var
 * once a Keycloak service is up and healthy — see
 * `.github/workflows/e2e-keycloak.yml`.
 */
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL ?? ''
const KEYCLOAK_ADMIN_USERNAME = process.env.KEYCLOAK_ADMIN_USERNAME ?? 'admin'
const KEYCLOAK_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin'

const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'
const CLIENT_ID = 'cedar-oauth-test'
const CLIENT_SECRET = 'cedar-oauth-test-secret'
const REDIRECT_URI = 'http://localhost:8910/auth/oauth/keycloak/callback'
const PASSWORD = 'Cedar-OAuth-Test-Password-1!'

// Unique per test run so re-runs against a long-lived Keycloak instance
// (a locally started container, say) never collide with a leftover realm.
const realmName = `cedar-oauth-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Mints a fresh Keycloak admin access token. Called before every admin REST
 * call rather than cached, since admin access tokens are short-lived and
 * this suite's setup can span several sequential HTTP round trips.
 */
async function getAdminAccessToken(): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: KEYCLOAK_ADMIN_USERNAME,
        password: KEYCLOAK_ADMIN_PASSWORD,
      }).toString(),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to obtain a Keycloak admin access token (${response.status}): ${await response.text()}`,
    )
  }

  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

async function adminRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${KEYCLOAK_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  })
}

/**
 * Runs `fn` with a freshly minted admin access token.
 */
async function withAdminToken<T>(
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = await getAdminAccessToken()
  return fn(token)
}

async function createRealm(token: string, realm: string): Promise<void> {
  const response = await adminRequest(token, '/admin/realms', {
    method: 'POST',
    body: JSON.stringify({ realm, enabled: true }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to create Keycloak realm '${realm}' (${response.status}): ${await response.text()}`,
    )
  }
}

async function deleteRealm(token: string, realm: string): Promise<void> {
  await adminRequest(token, `/admin/realms/${realm}`, { method: 'DELETE' })
}

async function createClient(token: string, realm: string): Promise<void> {
  const response = await adminRequest(token, `/admin/realms/${realm}/clients`, {
    method: 'POST',
    body: JSON.stringify({
      clientId: CLIENT_ID,
      secret: CLIENT_SECRET,
      enabled: true,
      protocol: 'openid-connect',
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      consentRequired: false,
      redirectUris: [REDIRECT_URI],
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to create Keycloak client '${CLIENT_ID}' (${response.status}): ${await response.text()}`,
    )
  }
}

/**
 * Creates a Keycloak user with a permanent password and no pending required
 * actions, so the login form POST below completes the flow in a single
 * round trip instead of landing on an "update account"/"verify email"
 * interstitial. Returns Keycloak's internal user id — the value the OIDC
 * id_token's `sub` claim carries, and so the value `providerUserId` must
 * equal on the Cedar side.
 */
async function createUser(
  token: string,
  realm: string,
  { username, email }: { username: string; email: string },
): Promise<string> {
  const response = await adminRequest(token, `/admin/realms/${realm}/users`, {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      emailVerified: true,
      enabled: true,
      firstName: 'Cedar',
      lastName: 'Test',
      requiredActions: [],
      credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to create Keycloak user '${username}' (${response.status}): ${await response.text()}`,
    )
  }

  const location = response.headers.get('location')
  if (!location) {
    throw new Error(
      `Keycloak did not return a Location header for created user '${username}'`,
    )
  }

  return location.split('/').pop()!
}

/**
 * Minimal cookie jar for carrying Keycloak's own session cookies
 * (`AUTH_SESSION_ID`, `KC_RESTART`, ...) across the login-page GET and the
 * form POST — plain `fetch` has no jar of its own.
 */
class CookieJar {
  private jar = new Map<string, string>()

  update(headers: Headers): void {
    for (const cookie of headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const separatorIndex = pair.indexOf('=')
      if (separatorIndex === -1) {
        continue
      }
      this.jar.set(
        pair.slice(0, separatorIndex).trim(),
        pair.slice(separatorIndex + 1).trim(),
      )
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

/**
 * GETs `url`, following any redirects Keycloak sends before it renders the
 * login page (some Keycloak versions bounce `/auth` to
 * `/login-actions/authenticate` first), carrying `cookieJar`'s cookies on
 * every hop and recording any new ones. Capped so a redirect loop fails the
 * test instead of hanging it.
 */
async function getFollowingRedirects(
  url: string,
  cookieJar: CookieJar,
): Promise<Response> {
  let currentUrl = url

  for (let i = 0; i < 5; i++) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { cookie: cookieJar.header() },
    })
    cookieJar.update(response.headers)

    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      return response
    }
    currentUrl = new URL(location, currentUrl).toString()
  }

  throw new Error(`Too many redirects while fetching ${url}`)
}

/**
 * Pulls the login form's `action` URL and its hidden input fields out of
 * Keycloak's login page HTML with a tolerant regex — no HTML parser
 * dependency, matching the pattern used for Keycloak login tests elsewhere.
 * Hidden fields (Keycloak themes vary in what they include, e.g.
 * `credentialId`) are carried through as-is; `username`/`password` are
 * supplied separately by the caller.
 */
function extractLoginForm(html: string): {
  action: string
  fields: Record<string, string>
} {
  const formTagMatch =
    html.match(/<form[^>]*id=["']kc-form-login["'][^>]*>/i) ??
    html.match(/<form[^>]*>/i)

  if (!formTagMatch) {
    throw new Error('Could not find a login form on the Keycloak login page')
  }

  const actionMatch = formTagMatch[0].match(/action=["']([^"']+)["']/i)
  if (!actionMatch) {
    throw new Error('Keycloak login form has no action attribute')
  }

  const fields: Record<string, string> = {}
  const inputTagPattern = /<input[^>]+>/gi
  let inputMatch: RegExpExecArray | null
  while ((inputMatch = inputTagPattern.exec(html))) {
    const inputTag = inputMatch[0]
    const nameMatch = inputTag.match(/name=["']([^"']+)["']/i)
    if (!nameMatch) {
      continue
    }
    const typeMatch = inputTag.match(/type=["']([^"']+)["']/i)
    if (typeMatch?.[1].toLowerCase() === 'submit') {
      continue
    }
    const valueMatch = inputTag.match(/value=["']([^"']*)["']/i)
    fields[nameMatch[1]] = valueMatch?.[1] ?? ''
  }

  return { action: actionMatch[1].replace(/&amp;/g, '&'), fields }
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
      keycloak: createOidcStrategy(
        {
          name: 'Keycloak',
          issuer: `${KEYCLOAK_BASE_URL}/realms/${realmName}`,
          scope: 'openid email profile',
        },
        {
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          redirectUri: REDIRECT_URI,
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

/**
 * Drives a full authorization-code + PKCE round trip against real Keycloak:
 * hits `authorize()` to get the redirect + transaction cookie, follows the
 * redirect to Keycloak's actual `/auth` endpoint, parses and POSTs the real
 * login form with `username`/`password`, then feeds the code Keycloak
 * redirects back with into `callback()` — exercising discovery, PKCE, the
 * token exchange, and id_token verification against genuine third-party
 * software.
 */
async function runKeycloakFlow({
  handlerOptions,
  flow,
  username,
}: {
  handlerOptions: OAuthHandlerOptions<any>
  flow: 'login' | 'signup'
  username: string
}) {
  const authorizeHandler = new OAuthHandler(
    {
      httpMethod: 'GET',
      path: '/auth/oauth/keycloak/authorize',
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

  const cookieJar = new CookieJar()
  const loginPageResponse = await getFollowingRedirects(
    authorizationUrl,
    cookieJar,
  )
  if (loginPageResponse.status !== 200) {
    throw new Error(
      `Expected Keycloak's login page to render (200), got ${loginPageResponse.status}: ${await loginPageResponse.text()}`,
    )
  }

  const { action, fields } = extractLoginForm(await loginPageResponse.text())

  const loginResponse = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieJar.header(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      ...fields,
      username,
      password: PASSWORD,
    }).toString(),
  })

  if (loginResponse.status < 300 || loginResponse.status >= 400) {
    throw new Error(
      `Expected the Keycloak login form submission to redirect (300–399), got ${loginResponse.status}: ${await loginResponse.text()}`,
    )
  }

  const redirectLocation = new URL(loginResponse.headers.get('location')!)

  const callbackHandler = new OAuthHandler(
    {
      httpMethod: 'GET',
      path: '/auth/oauth/keycloak/callback',
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

  return callbackHandler.invoke()
}

describe.skipIf(!process.env.KEYCLOAK_BASE_URL)(
  'OAuthHandler + createOidcStrategy against a real Keycloak realm',
  () => {
    beforeAll(async () => {
      await withAdminToken((token) => createRealm(token, realmName))
      await withAdminToken((token) => createClient(token, realmName))
    }, 60_000)

    afterAll(async () => {
      await withAdminToken((token) => deleteRealm(token, realmName))
    }, 60_000)

    beforeEach(() => {
      process.env.SESSION_SECRET = SESSION_SECRET
    })

    it('signs a new user up end to end', async () => {
      const username = `signup-${Date.now()}`
      const email = `${username}@cedarjs.example`
      const keycloakUserId = await withAdminToken((token) =>
        createUser(token, realmName, { username, email }),
      )

      const db = new DbMock(['user', 'oAuth'])

      const response = await runKeycloakFlow({
        handlerOptions: baseOptions(db),
        flow: 'signup',
        username,
      })

      expect((response.headers as any).location).toBe('/welcome')

      const setCookies = (response.headers['set-cookie'] as string[]) ?? []
      const sessionCookie = setCookies.find((c) => c.startsWith('session='))
      expect(sessionCookie).toBeTruthy()

      expect(db.user.records).toHaveLength(1)
      expect(db.user.records[0].email).toBe(email)
      expect(db.oAuth.records).toHaveLength(1)
      expect(db.oAuth.records[0].providerUserId).toBe(keycloakUserId)

      const [session] = decryptSession(getSession(sessionCookie, undefined))
      expect(session.id).toBe(db.user.records[0].id)
    }, 30_000)

    it('logs an existing user in end to end', async () => {
      const username = `login-${Date.now()}`
      const email = `${username}@cedarjs.example`
      const keycloakUserId = await withAdminToken((token) =>
        createUser(token, realmName, { username, email }),
      )

      const db = new DbMock(['user', 'oAuth'])
      const user = db.user.create({ data: { email } })
      db.oAuth.create({
        data: {
          provider: 'keycloak',
          providerUserId: keycloakUserId,
          userId: user.id,
        },
      })

      const response = await runKeycloakFlow({
        handlerOptions: baseOptions(db),
        flow: 'login',
        username,
      })

      expect((response.headers as any).location).toBe('/dashboard')

      const setCookies = (response.headers['set-cookie'] as string[]) ?? []
      const sessionCookie = setCookies.find((c) => c.startsWith('session='))
      expect(sessionCookie).toBeTruthy()

      const [session] = decryptSession(getSession(sessionCookie, undefined))
      expect(session.id).toBe(user.id)
    }, 30_000)
  },
)
