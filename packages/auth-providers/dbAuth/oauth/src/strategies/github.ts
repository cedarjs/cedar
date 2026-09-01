// `oauth4webapi` is an optional peer dependency, only ever lazy-imported at
// runtime (see `handleCallback` below) — this is a type-only import, erased
// at compile time, so it doesn't require the package to be installed to run.
import type { AuthorizationServer, Client } from 'oauth4webapi'

import { ProviderError } from '../errors.js'
import type {
  OAuthAuthorizationContext,
  OAuthCallbackContext,
  OAuthProviderCredentials,
  OAuthStrategy,
  OAuthUserInfo,
} from '../types.js'

const AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize'
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'
const PROFILE_ENDPOINT = 'https://api.github.com/user'
const EMAILS_ENDPOINT = 'https://api.github.com/user/emails'

interface GitHubProfile {
  id: number
  login: string
  email: string | null
  [key: string]: unknown
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * GitHub's standard user OAuth flow issues no id_token (its OIDC discovery
 * document is a preview limited to MCP clients), so this strategy is built
 * entirely through the public `OAuthStrategy` interface — the same one
 * available to userland strategy packages — rather than the OIDC path in
 * `oidc.ts`.
 *
 * @example
 * ```ts
 * providers: {
 *   github: githubProvider({
 *     clientId: process.env.GITHUB_CLIENT_ID,
 *     clientSecret: process.env.GITHUB_CLIENT_SECRET,
 *     redirectUri: `${apiUrl}/auth/oauth/github/callback`,
 *   }),
 * }
 * ```
 */
export function githubProvider(
  credentials: OAuthProviderCredentials,
): OAuthStrategy {
  return {
    name: 'GitHub',
    redirectUri: credentials.redirectUri,
    usesOidc: false,

    getAuthorizationUrl(ctx: OAuthAuthorizationContext): URL {
      const url = new URL(AUTHORIZATION_ENDPOINT)
      url.searchParams.set('client_id', credentials.clientId)
      url.searchParams.set('redirect_uri', ctx.redirectUri)
      url.searchParams.set('scope', credentials.scope ?? 'read:user user:email')
      url.searchParams.set('state', ctx.state)
      // GitHub's OAuth apps flow doesn't document PKCE support, but per RFC
      // 6749 unrecognized authorization parameters must be ignored, and
      // sending it is harmless when unsupported (see Decision 2 in the
      // implementation plan: PKCE is used uniformly for every provider).
      url.searchParams.set('code_challenge', ctx.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')

      return url
    },

    async handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo> {
      const oauth = await import('oauth4webapi')

      const as: AuthorizationServer = {
        issuer: 'https://github.com',
        token_endpoint: TOKEN_ENDPOINT,
      }
      const client: Client = {
        client_id: credentials.clientId,
      }
      const clientAuth = oauth.ClientSecretPost(credentials.clientSecret)

      // `authorizationCodeGrantRequest` only accepts `URLSearchParams`
      // "branded" by having gone through `validateAuthResponse` first (it
      // checks for a returned `error` and confirms `state` itself, in
      // addition to marking the params as validated).
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
        // GitHub's token endpoint returns form-urlencoded by default; ask
        // for JSON explicitly, which is what oauth4webapi expects to parse.
        { headers: { Accept: 'application/json' } },
      )

      const result = await oauth.processAuthorizationCodeResponse(
        as,
        client,
        response,
        { requireIdToken: false },
      )

      const profile = await fetchJson<GitHubProfile>(
        PROFILE_ENDPOINT,
        result.access_token,
      )

      // GitHub's user id is always a number; without this check a
      // malformed or unexpected profile response would fall through to
      // `String(profile.id)`, silently keying the identity on the string
      // `'undefined'` instead of failing loudly.
      if (typeof profile.id !== 'number') {
        throw new ProviderError(
          'GitHub profile response is missing a numeric id',
        )
      }

      let email = profile.email ?? undefined
      let emailVerified: boolean | undefined

      if (!email) {
        const emails = await fetchJson<GitHubEmail[]>(
          EMAILS_ENDPOINT,
          result.access_token,
        )
        const primary = emails.find((e) => e.primary && e.verified)
        email = primary?.email
        emailVerified = primary ? true : undefined
      }

      return {
        // GitHub's numeric `id` is immutable; `login` (the username) can
        // change, so it's never used to key account lookup.
        providerUserId: String(profile.id),
        email,
        emailVerified,
        username: profile.login,
        raw: profile,
      }
    },
  }
}

async function fetchJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CedarJS',
    },
  })

  if (!response.ok) {
    throw new ProviderError(
      `GitHub API request to ${url} failed with status ${response.status}`,
    )
  }

  return response.json() as Promise<T>
}
