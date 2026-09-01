/**
 * Web client for dbAuth's OAuth routes.
 *
 * The OAuth handler lives in the same auth function as the rest of dbAuth,
 * under the `/oauth` sub-path (e.g. `${RWJS_API_URL}/auth/oauth`). This
 * module derives that base URL exactly the way `dbAuth.ts` does, and offers
 * the same `dbAuthUrl` override affordance.
 */

/**
 * The three account flows the server distinguishes between, so a user can
 * never accidentally create a duplicate account by logging in with a
 * provider.
 */
export type OAuthFlow = 'login' | 'signup' | 'link'

/**
 * Error codes the OAuth handler's redirect can carry as `?error=<code>`.
 */
export type OAuthErrorCode =
  | 'unknown_provider'
  | 'invalid_state'
  | 'provider_error'
  | 'unknown_identity'
  | 'email_in_use'
  | 'identity_in_use'
  | 'not_authenticated'
  | 'flow_not_enabled'
  | 'cannot_unlink_last_identity'
  | 'server_error'

const OAUTH_ERROR_CODES: readonly OAuthErrorCode[] = [
  'unknown_provider',
  'invalid_state',
  'provider_error',
  'unknown_identity',
  'email_in_use',
  'identity_in_use',
  'not_authenticated',
  'flow_not_enabled',
  'cannot_unlink_last_identity',
  'server_error',
]

function isOAuthErrorCode(value: string): value is OAuthErrorCode {
  // `Array#includes` requires its argument to match the array's element
  // type. Widening to `readonly string[]` lets us test an arbitrary string
  // against the known codes; the type guard return narrows it back down.
  return (OAUTH_ERROR_CODES as readonly string[]).includes(value)
}

export interface OAuthClientOptions {
  /**
   * Overrides the derived dbAuth base URL (the same override `dbAuth.ts`
   * offers via `DbAuthClientArgs.dbAuthUrl`).
   */
  dbAuthUrl?: string
}

export interface GetOAuthUrlOptions extends OAuthClientOptions {
  /** Which account flow to start. Defaults to `'login'`. */
  flow?: OAuthFlow
}

export interface UnlinkOAuthProviderSuccess {
  ok: true
}

export interface UnlinkOAuthProviderFailure {
  error: string
}

export type UnlinkOAuthProviderResult =
  UnlinkOAuthProviderSuccess | UnlinkOAuthProviderFailure

function getDbAuthUrl(dbAuthUrl?: string) {
  return dbAuthUrl || `${RWJS_API_URL}/auth`
}

/**
 * Builds the absolute URL for a provider's `authorize` route. Navigate the
 * full page to this URL (e.g. `window.location.href = getOAuthUrl(...)`) —
 * it starts a browser redirect flow, so it must not be `fetch`ed.
 */
export function getOAuthUrl(
  provider: string,
  options?: GetOAuthUrlOptions,
): string {
  const flow = options?.flow ?? 'login'
  const baseUrl = getDbAuthUrl(options?.dbAuthUrl)

  return `${baseUrl}/oauth/${encodeURIComponent(provider)}/authorize?flow=${flow}`
}

/**
 * Unlinks a provider identity from the current dbAuth session. Requires the
 * dbAuth session cookie, so the request is sent with credentials included.
 */
export async function unlinkOAuthProvider(
  provider: string,
  options?: OAuthClientOptions,
): Promise<UnlinkOAuthProviderResult> {
  const baseUrl = getDbAuthUrl(options?.dbAuthUrl)

  const response = await fetch(
    `${baseUrl}/oauth/${encodeURIComponent(provider)}/unlink`,
    {
      method: 'POST',
      credentials: 'include',
    },
  )

  return response.json()
}

/**
 * Extracts and narrows the `error` query param the OAuth handler's redirect
 * carries after a failed flow. Returns `null` when there is no `error`
 * param, or when its value isn't one of the known OAuth error codes.
 */
export function getOAuthError(
  searchParams: URLSearchParams | string,
): OAuthErrorCode | null {
  const params =
    typeof searchParams === 'string'
      ? new URLSearchParams(searchParams)
      : searchParams

  const error = params.get('error')

  if (error && isOAuthErrorCode(error)) {
    return error
  }

  return null
}
