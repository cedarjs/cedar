import type { Client } from 'oauth4webapi'
import { describe, expect, it } from 'vitest'

import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  hasGoogleAppCredentials,
  hasGoogleRefreshToken,
} from './env.mts'
import { fetchJson } from './http.mts'

const DISCOVERY_URL =
  'https://accounts.google.com/.well-known/openid-configuration'

interface GoogleDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  response_types_supported: string[]
  code_challenge_methods_supported: string[]
  id_token_signing_alg_values_supported: string[]
}

interface Jwks {
  keys: {
    kty: string
    kid: string
    n: string
    e: string
    use?: string
    alg?: string
  }[]
}

async function fetchGoogleDiscovery(): Promise<GoogleDiscovery> {
  const { status, body } = await fetchJson<GoogleDiscovery>(DISCOVERY_URL)
  expect(status).toBe(200)
  return body
}

describe('Google OIDC discovery (Tier 1 — zero credentials)', () => {
  it('publishes the endpoints and algorithms createOidcStrategy relies on', async () => {
    const discovery = await fetchGoogleDiscovery()

    // Subset assertion on only the fields `createOidcStrategy` (see
    // packages/auth-providers/dbAuth/oauth/src/oidc.ts) reads off the
    // discovery document. Google adding fields to the document must never
    // fail this job.
    expect(discovery).toMatchObject({
      issuer: 'https://accounts.google.com',
      authorization_endpoint: expect.stringMatching(/^https:\/\//),
      token_endpoint: expect.stringMatching(/^https:\/\//),
      jwks_uri: expect.stringMatching(/^https:\/\//),
    })
    expect(discovery.response_types_supported).toContain('code')
    expect(discovery.code_challenge_methods_supported).toContain('S256')
    expect(discovery.id_token_signing_alg_values_supported).toContain('RS256')
  })

  it('publishes a JWKS with usable RS256 signing keys', async () => {
    const discovery = await fetchGoogleDiscovery()
    const { status, body: jwks } = await fetchJson<Jwks>(discovery.jwks_uri)

    expect(status).toBe(200)
    expect(Array.isArray(jwks.keys)).toBe(true)
    expect(jwks.keys.length).toBeGreaterThan(0)

    for (const key of jwks.keys) {
      expect(key).toMatchObject({
        kty: 'RSA',
        kid: expect.any(String),
        n: expect.any(String),
        e: expect.any(String),
      })
    }

    // An RSA key isn't necessarily usable for *signing* -- an encryption
    // key (`use: 'enc'`) can have the same `kty`. `createOidcStrategy`
    // verifies RS256 id_token signatures, so the document must publish at
    // least one key actually marked for that.
    const hasUsableSigningKey = jwks.keys.some(
      (key) => key.use === 'sig' || key.alg === 'RS256',
    )
    expect(hasUsableSigningKey).toBe(true)
  })
})

describe.skipIf(!hasGoogleAppCredentials)(
  'Google token endpoint (Tier 2 — app credentials)',
  () => {
    it('accepts client authentication and rejects a bogus code as invalid_grant', async () => {
      const discovery = await fetchGoogleDiscovery()

      const { status, body } = await fetchJson<{ error?: string }>(
        discovery.token_endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'oauth-contract-test-bogus-code',
            redirect_uri: 'https://example.com/oauth-contract-test/callback',
            // Non-null assertions are safe: `describe.skipIf` above only
            // runs this suite when `hasGoogleAppCredentials` is true.
            client_id: GOOGLE_CLIENT_ID!,
            client_secret: GOOGLE_CLIENT_SECRET!,
          }),
        },
      )

      // A real client id/secret pair rejecting a bogus code as
      // `invalid_grant` (the code itself is bad) — not `invalid_client`
      // (the credentials are bad) — proves the client authentication
      // format Cedar's OIDC strategy sends is still accepted.
      expect(status).toBe(400)
      expect(body.error).toBe('invalid_grant')
    })
  },
)

describe.skipIf(!hasGoogleRefreshToken)(
  'Google refresh-token grant (Tier 3 — non-interactive tokens)',
  () => {
    it('refreshes an id_token, validates it via oauth4webapi, and fetches userinfo', async () => {
      const oauth = await import('oauth4webapi')

      const issuer = new URL('https://accounts.google.com')
      const discoveryResponse = await oauth.discoveryRequest(issuer)
      const as = await oauth.processDiscoveryResponse(issuer, discoveryResponse)

      // Non-null assertions below are safe: `describe.skipIf` above only
      // runs this suite when `hasGoogleRefreshToken` is true, which also
      // requires the Tier 2 app credentials to be set.
      const client: Client = { client_id: GOOGLE_CLIENT_ID! }
      const clientAuth = oauth.ClientSecretPost(GOOGLE_CLIENT_SECRET!)

      const response = await oauth.refreshTokenGrantRequest(
        as,
        client,
        clientAuth,
        GOOGLE_REFRESH_TOKEN!,
      )
      const result = await oauth.processRefreshTokenResponse(
        as,
        client,
        response,
      )

      const claims = oauth.getValidatedIdTokenClaims(result)
      if (!claims) {
        throw new Error(
          'Expected the refresh grant to return a validated id_token ' +
            '(Google returns one for the openid scope).',
        )
      }
      expect(typeof claims.sub).toBe('string')

      const userInfoResponse = await oauth.userInfoRequest(
        as,
        client,
        result.access_token,
      )
      const userInfo = await oauth.processUserInfoResponse(
        as,
        client,
        claims.sub,
        userInfoResponse,
      )

      // Subset assertion on only the fields a strategy built on this path
      // would read off a Google userinfo response.
      expect(userInfo).toMatchObject({ sub: claims.sub })
      expect(typeof userInfo.email).toBe('string')
      expect(typeof userInfo.email_verified).toBe('boolean')
    })
  },
)
