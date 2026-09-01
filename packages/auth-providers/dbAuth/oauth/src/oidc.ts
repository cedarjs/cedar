// `oauth4webapi` is an optional peer dependency, only ever lazy-imported at
// runtime (see `discover()` below) — this is a type-only import, erased at
// compile time, so it doesn't require the package to be installed to run.
import type { Client } from 'oauth4webapi'

import { ProviderError } from './errors.js'
import type {
  OAuthAuthorizationContext,
  OAuthCallbackContext,
  OAuthProviderCredentials,
  OAuthStrategy,
  OAuthUserInfo,
  ProviderPreset,
} from './types.js'

/**
 * Turns a data-only `ProviderPreset` (issuer, default scope) plus per-app
 * credentials into a full `OAuthStrategy`, using `oauth4webapi` for OIDC
 * discovery, the authorization-code + PKCE + nonce flow, and id_token
 * verification. `oauth4webapi` is an optional peer dependency and is only
 * ever lazy-imported here, so apps that don't configure any OIDC provider
 * never need it installed.
 */
export function createOidcStrategy(
  preset: ProviderPreset,
  credentials: OAuthProviderCredentials,
): OAuthStrategy {
  // Cached across calls for a given strategy instance so discovery only
  // happens once per warm lambda/server process, not once per request.
  let discoveryPromise: ReturnType<typeof discover> | undefined

  async function discover() {
    const oauth = await import('oauth4webapi')
    const issuer = new URL(preset.issuer)

    const insecureOptions = credentials.allowInsecureRequests
      ? { [oauth.allowInsecureRequests]: true }
      : {}

    const response = await oauth.discoveryRequest(issuer, insecureOptions)
    const as = await oauth.processDiscoveryResponse(issuer, response)
    const client: Client = {
      client_id: credentials.clientId,
    }
    const clientAuth = oauth.ClientSecretPost(credentials.clientSecret)

    return { oauth, as, client, clientAuth }
  }

  function getDiscovery() {
    if (!discoveryPromise) {
      discoveryPromise = discover()
      // A rejected discovery attempt (e.g. a transient network error, or the
      // discovery endpoint being briefly unavailable) must not be cached
      // forever -- clearing it here lets the next call retry instead of
      // permanently disabling the provider after one failure.
      discoveryPromise.catch(() => {
        discoveryPromise = undefined
      })
    }
    return discoveryPromise
  }

  return {
    name: preset.name,
    redirectUri: credentials.redirectUri,
    usesOidc: true,

    async getAuthorizationUrl(ctx: OAuthAuthorizationContext): Promise<URL> {
      const { as } = await getDiscovery()

      if (!as.authorization_endpoint) {
        throw new ProviderError(
          `${preset.name} discovery document has no authorization_endpoint`,
        )
      }

      const url = new URL(as.authorization_endpoint)
      url.searchParams.set('client_id', credentials.clientId)
      url.searchParams.set('redirect_uri', ctx.redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', credentials.scope ?? preset.scope)
      url.searchParams.set('state', ctx.state)
      url.searchParams.set('code_challenge', ctx.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')

      if (ctx.nonce) {
        url.searchParams.set('nonce', ctx.nonce)
      }

      return url
    },

    async handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo> {
      const { oauth, as, client, clientAuth } = await getDiscovery()

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

      const insecureOptions = credentials.allowInsecureRequests
        ? { [oauth.allowInsecureRequests]: true }
        : {}

      const response = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        clientAuth,
        params,
        ctx.redirectUri,
        ctx.codeVerifier,
        insecureOptions,
      )

      // No `allowInsecureRequests` needed here: an id_token obtained
      // directly from the token endpoint (rather than via the browser, as
      // with JARM) doesn't need a separate JWKS signature check — the
      // TLS-authenticated, client-authenticated back-channel already
      // provides that trust, per oauth4webapi's design.
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
        throw new ProviderError(`${preset.name} did not return an id_token`)
      }

      const emailVerified =
        typeof claims.email_verified === 'boolean'
          ? claims.email_verified
          : undefined

      return {
        providerUserId: claims.sub,
        // An unverified email must never seed a username or feed the
        // duplicate-account (`email_in_use`) check -- anyone can put an
        // arbitrary address in an OIDC profile the provider hasn't
        // confirmed they control, so only a claim with
        // `email_verified: true` is passed through.
        email:
          typeof claims.email === 'string' && emailVerified === true
            ? claims.email
            : undefined,
        emailVerified,
        username: typeof claims.name === 'string' ? claims.name : undefined,
        raw: claims,
      }
    },
  }
}
