import type { CorsConfig } from '@cedarjs/api'
import type { DbAuthCookieConfig } from '@cedarjs/auth-dbauth-api'

/**
 * The three flows a caller can start an OAuth transaction with, plus the
 * `unlink` flow which never leaves the app (no redirect round-trip).
 *
 * - `login`: the `(provider, providerUserId)` identity must already exist.
 *   Prevents a user from accidentally creating a duplicate account by
 *   logging in with a provider they haven't linked yet.
 * - `signup`: creates a new user row plus the identity row. Fails if the
 *   provider's email matches an existing account (the user should log in
 *   and link instead).
 * - `link`: attaches a provider identity to the account of the currently
 *   logged-in dbAuth user. Requires a valid dbAuth session cookie.
 * - `unlink`: removes a provider identity from the current dbAuth user's
 *   account. JSON POST, no redirect, refuses to remove the last identity
 *   from an account with no password.
 */
export type OAuthFlow = 'login' | 'signup' | 'link' | 'unlink'

/**
 * Canonical profile a strategy hands back to the OAuth handler once the
 * token exchange (and, for OIDC, id_token verification) is complete.
 *
 * `providerUserId` is the only field account lookup ever keys on — never
 * `email` or `username`. For OIDC providers it must be the id_token's
 * validated `sub` claim; for non-OIDC providers (GitHub, Facebook-shaped
 * strategies) it must be the provider's immutable numeric/opaque user id,
 * stringified.
 */
export interface OAuthUserInfo {
  providerUserId: string
  email?: string
  emailVerified?: boolean
  username?: string
  /** The raw profile/claims the strategy read `providerUserId`/`email`/etc from, for debugging. */
  raw?: Record<string, unknown>
}

/**
 * Passed to `OAuthStrategy.getAuthorizationUrl`. The handler generates
 * `state`, the PKCE pair, and (when `usesOidc` is true) `nonce` itself so
 * every strategy gets the same CSRF/replay protection; the strategy's job is
 * only to fold them into the URL its provider expects.
 */
export interface OAuthAuthorizationContext {
  /** The key this strategy is registered under in `providers`, e.g. `'google'`. */
  provider: string
  /** Absolute callback URL registered with the provider for this provider key. */
  redirectUri: string
  flow: OAuthFlow
  state: string
  codeVerifier: string
  /** S256 `code_challenge` precomputed from `codeVerifier`, for convenience. */
  codeChallenge: string
  /** Present only when the strategy's `usesOidc` is true. */
  nonce: string | undefined
}

/**
 * Passed to `OAuthStrategy.handleCallback` once the handler has already
 * verified `state` against the transaction cookie and confirmed the
 * provider didn't return an `error` param. The strategy owns everything
 * from here: token exchange, id_token/JWKS verification (if any), userinfo,
 * and mapping the result to `OAuthUserInfo`.
 */
export interface OAuthCallbackContext {
  provider: string
  redirectUri: string
  flow: OAuthFlow
  /**
   * The `state` value generated for this transaction. The handler has
   * already checked it against the callback's own `state` param, but a
   * strategy using `oauth4webapi`'s `authorizationCodeGrantRequest` still
   * needs it: that function only accepts `URLSearchParams` "branded" by
   * having been passed through `oauth.validateAuthResponse(as, client,
   * params, state)` first.
   */
  state: string
  /** The PKCE verifier generated for this transaction (matches `codeVerifier` from the authorization step). */
  codeVerifier: string
  /** The nonce generated for this transaction, when `usesOidc` is true. */
  nonce: string | undefined
  /** Query-string params from the callback request (used by GET callbacks). */
  query: Record<string, string>
  /**
   * Parsed `application/x-www-form-urlencoded` body params (used by
   * `form_post` callbacks, e.g. Apple's cross-site POST). Empty for GET
   * callbacks.
   */
  form: Record<string, string>
}

/**
 * The public extension point for adding an OAuth provider: presets (Google)
 * and built-in strategies (GitHub) are implemented purely through this
 * interface, so anything they can do a userland strategy package can too.
 */
export interface OAuthStrategy {
  /** Human-readable name, used in error messages/logs. */
  name: string
  /**
   * Absolute callback URL registered with the provider for this strategy,
   * e.g. `https://example.com/auth/oauth/google/callback`. The handler
   * doesn't compute this itself (it can't know which public host a
   * provider's app-registration console has on file) — it just reads it
   * back off the strategy and threads it through
   * `OAuthAuthorizationContext`/`OAuthCallbackContext` for convenience.
   */
  redirectUri: string
  /**
   * Whether this strategy participates in OIDC nonce handling. Presets
   * (OIDC-compliant providers) set this to `true`; non-OIDC strategies like
   * GitHub leave it `false` (or omitted) and the handler skips nonce
   * generation for them.
   */
  usesOidc?: boolean
  /**
   * Builds the full authorization URL to redirect the user to. Receives the
   * handler-generated state/PKCE/nonce so the URL can embed them, plus
   * whatever extra parameters the provider needs.
   */
  getAuthorizationUrl(ctx: OAuthAuthorizationContext): Promise<URL> | URL
  /**
   * Completes the token exchange and returns the canonical profile. Throw to
   * abort the flow — the handler catches it, logs the real message
   * server-side, and redirects with the generic `provider_error` code so no
   * exception text reaches the client.
   */
  handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo>
}

/**
 * Data-only description of an OIDC-compliant provider: enough to run
 * discovery and build a standard authorization-code + PKCE + nonce flow
 * against it. Turn one into an `OAuthStrategy` with `createOidcStrategy`.
 */
export interface ProviderPreset {
  /** Display name, e.g. `'Google'`. */
  name: string
  /** Issuer URL used for OIDC discovery (`${issuer}/.well-known/openid-configuration`). */
  issuer: string
  /** Space-separated default scopes. Must include `openid`. */
  scope: string
}

/**
 * Per-provider credentials used to turn a `ProviderPreset` into an
 * `OAuthStrategy`, or to configure a built-in strategy factory (e.g.
 * `githubProvider`).
 */
export interface OAuthProviderCredentials {
  clientId: string
  clientSecret: string
  /** Absolute callback URL registered with the provider, e.g. `https://example.com/auth/oauth/google/callback`. */
  redirectUri: string
  /** Overrides the preset/strategy default scope, when set. */
  scope?: string
  /**
   * Test-only: allow `http://` issuer/token/authorization endpoints.
   * Defaults to false. Never enable this outside of tests.
   */
  allowInsecureRequests?: boolean
}

/**
 * Field names on the identity (`oauthModelAccessor`) Prisma model. Defaults
 * assume a model shaped like the community-plugin's `OAuth` model:
 * `provider`, `providerUserId`, `userId`, plus optional
 * `providerUsername`/`providerEmail`/`createdAt`/`updatedAt`. Uniqueness is
 * assumed on `(provider, providerUserId)` and `(userId, provider)`.
 */
export interface OAuthIdentityFields {
  provider: string
  providerUserId: string
  userId: string
  providerUsername: string
  providerEmail: string
}

export const DEFAULT_OAUTH_IDENTITY_FIELDS: OAuthIdentityFields = {
  provider: 'provider',
  providerUserId: 'providerUserId',
  userId: 'userId',
  providerUsername: 'providerUsername',
  providerEmail: 'providerEmail',
}

/**
 * Options passed to `signup.handler`: the OAuth profile plus the provider
 * key, so the handler can create the user row (password fields absent) the
 * same way `DbAuthHandlerOptions['signup'].handler` creates one for
 * username/password signup.
 */
export interface OAuthSignupHandlerOptions {
  provider: string
  profile: OAuthUserInfo
}

export type UserType = Record<string | number, any>

export interface OAuthRedirects {
  /** Path or absolute URL to send the browser to after a successful login. */
  afterLogin: string
  /** Defaults to `afterLogin` when omitted. */
  afterSignup?: string
  /** Defaults to `afterLogin` when omitted. */
  afterLink?: string
  /**
   * Path or absolute URL to send the browser to on failure. The stable
   * error code is appended as `?error=<code>&provider=<name>` (additional
   * existing query params are preserved).
   */
  error: string
}

export interface OAuthHandlerOptions<
  TDb extends object = Record<string, unknown>,
> {
  /** Prisma client (or a compatible mock in tests). */
  db: TDb
  /** Property on `db` for the user table, e.g. `'user'` for `db.user`. */
  authModelAccessor: keyof TDb
  /** Property on `db` for the identity table, e.g. `'oAuth'` for `db.oAuth`. */
  oauthModelAccessor: keyof TDb
  /** Field name mapping on the identity model. Unset fields fall back to `DEFAULT_OAUTH_IDENTITY_FIELDS`. */
  oauthFields?: Partial<OAuthIdentityFields>
  /**
   * Field name mapping on the user model. `id` matches
   * `DbAuthHandlerOptions.authFields.id`. `username` is matched against a
   * provider's returned email for the signup email-collision guard (it's
   * usually the same field dbAuth's own `authFields.username` points at,
   * typically `'email'`). `hashedPassword` is used by the `unlink` guard to
   * tell a password-protected account from a provider-only one.
   */
  authFields: {
    id: string
    username: string
    hashedPassword: string
  }
  /** Fields allowed back to the client in the session cookie payload. Defaults to `['id', 'email']`. */
  allowedUserFields?: string[]
  /** Configured providers, keyed by the path segment used in `/auth/oauth/{key}/...`. */
  providers: Record<string, OAuthStrategy>
  /** Defaults to `/auth/oauth`. */
  basePath?: string
  redirects: OAuthRedirects
  signup:
    | {
        enabled?: boolean
        handler: (
          options: OAuthSignupHandlerOptions,
        ) => UserType | Promise<UserType>
      }
    | { enabled: false }
  /** How long the minted session lasts, in seconds. Mirrors `DbAuthHandlerOptions['login'].expires`. */
  sessionExpires: number
  /** How long the OAuth transaction cookie is valid for, in seconds. Defaults to 600 (10 minutes). */
  transactionExpires?: number
  /** Cookie config applied to both the session cookie (via `createLoginResponse`) and the transaction cookie. */
  cookie?: DbAuthCookieConfig
  /**
   * Cookie config for the OAuth transaction cookie only, replacing `cookie`
   * for it (not merged). Needed for a provider whose callback arrives as a
   * cross-site `form_post` (e.g. Apple): the browser only sends a cookie on
   * a cross-site POST when it carries `SameSite: 'None'` plus `Secure`, but
   * setting that on `cookie` would also loosen the session cookie's
   * `SameSite` policy for every provider, not just the one that needs it.
   * Set this only for apps that configure such a provider; every other app
   * keeps the transaction cookie on `cookie`'s (typically `Lax`) policy.
   */
  transactionCookie?: DbAuthCookieConfig
  cors?: CorsConfig
}
