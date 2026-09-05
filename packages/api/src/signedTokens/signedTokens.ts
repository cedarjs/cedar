import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'

/**
 * Name of the environment variable that holds the default secret used to
 * sign and verify tokens when no `secret` option is passed.
 */
export const SIGNED_TOKEN_SECRET_ENV_VAR = 'SIGNED_TOKEN_SECRET'

/**
 * Machine-readable reason a `SignedTokenError` was thrown. Use it to tell an
 * expired link apart from a tampered one without matching on the message.
 */
export type SignedTokenErrorCode =
  | 'MISSING_SECRET'
  | 'MISSING_PURPOSE'
  | 'MISSING_TOKEN'
  | 'SIGN_FAILED'
  | 'INVALID'
  | 'EXPIRED'
  | 'PURPOSE_MISMATCH'

/**
 * Thrown by `createSignedToken` and `verifySignedToken` whenever a token
 * cannot be created or cannot be trusted. Verification never returns `null`
 * or `false` for a bad token; it always throws so a missing check cannot
 * silently pass.
 */
export class SignedTokenError extends Error {
  code: SignedTokenErrorCode

  constructor(code: SignedTokenErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SignedTokenError'
    this.code = code
  }
}

/**
 * How long a token stays valid. A number is a count of seconds. A string is
 * a duration such as `'10m'`, `'2h'`, or `'7 days'`.
 */
export type SignedTokenExpiresIn = NonNullable<SignOptions['expiresIn']>

export interface CreateSignedTokenOptions<TPayload extends object> {
  /**
   * The claims to carry inside the token. Serialized as JSON, so only
   * JSON-compatible values survive the round trip (a `Date` comes back as a
   * string).
   */
  payload: TPayload
  /**
   * What the token is for, such as `'google-oauth-state'` or
   * `'email-confirmation'`. A token only verifies when the same purpose is
   * passed to `verifySignedToken`, so a token minted for one flow cannot be
   * replayed in another.
   */
  purpose: string
  /** How long the token stays valid. See `SignedTokenExpiresIn`. */
  expiresIn: SignedTokenExpiresIn
  /**
   * The secret to sign with. Defaults to the `SIGNED_TOKEN_SECRET`
   * environment variable. There is no built-in fallback: when neither is set
   * a `SignedTokenError` with code `MISSING_SECRET` is thrown.
   */
  secret?: string
}

export interface VerifySignedTokenOptions {
  /** The purpose the token must have been created with. */
  purpose: string
  /**
   * The secret to verify with. Defaults to the `SIGNED_TOKEN_SECRET`
   * environment variable. There is no built-in fallback: when neither is set
   * a `SignedTokenError` with code `MISSING_SECRET` is thrown.
   */
  secret?: string
}

/** The claims Cedar stores inside a signed token. */
interface SignedTokenClaims {
  payload: object
  purpose: string
  exp: number
}

/**
 * Tokens are signed with HS256 and verification only accepts HS256, so a
 * token that names another algorithm in its header (including `none`) is
 * rejected before its signature is even looked at.
 */
const ALGORITHM = 'HS256'

function resolveSecret(
  secret: string | undefined,
  action: 'create' | 'verify',
): string {
  const resolved = secret ?? process.env[SIGNED_TOKEN_SECRET_ENV_VAR]

  if (typeof resolved === 'string' && resolved.length > 0) {
    return resolved
  }

  throw new SignedTokenError(
    'MISSING_SECRET',
    `Cannot ${action} a signed token because no secret is configured. Set ` +
      `the ${SIGNED_TOKEN_SECRET_ENV_VAR} environment variable (generate a ` +
      'value with `yarn cedar generate secret`), or pass the `secret` ' +
      'option explicitly.',
  )
}

function assertPurpose(purpose: unknown): asserts purpose is string {
  if (typeof purpose === 'string' && purpose.length > 0) {
    return
  }

  throw new SignedTokenError(
    'MISSING_PURPOSE',
    'A signed token needs a non-empty `purpose` string, such as ' +
      "'google-oauth-state' or 'email-confirmation'. The purpose is what " +
      'stops a token created for one flow from verifying in another.',
  )
}

function isSignedTokenClaims(claims: unknown): claims is SignedTokenClaims {
  if (typeof claims !== 'object' || claims === null) {
    return false
  }

  if (!('payload' in claims) || !('purpose' in claims) || !('exp' in claims)) {
    return false
  }

  return (
    typeof claims.payload === 'object' &&
    claims.payload !== null &&
    typeof claims.purpose === 'string' &&
    typeof claims.exp === 'number'
  )
}

/**
 * Creates a compact, URL-safe token that carries `payload`, is bound to
 * `purpose`, expires after `expiresIn`, and is signed so it can only have
 * come from this application.
 *
 * Use it wherever a value has to leave the server and come back untouched:
 * OAuth `state`, email confirmation and password-set links, unsubscribe
 * links, or short-lived capability tokens.
 *
 * @example
 *
 *    const state = createSignedToken({
 *      payload: { organizationId, userId },
 *      purpose: 'google-oauth-state',
 *      expiresIn: '10m',
 *    })
 */
export function createSignedToken<TPayload extends object>({
  payload,
  purpose,
  expiresIn,
  secret,
}: CreateSignedTokenOptions<TPayload>): string {
  assertPurpose(purpose)
  const resolvedSecret = resolveSecret(secret, 'create')

  try {
    return jwt.sign({ payload, purpose }, resolvedSecret, {
      algorithm: ALGORITHM,
      expiresIn,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)

    throw new SignedTokenError(
      'SIGN_FAILED',
      `Could not create signed token: ${message}`,
      e,
    )
  }
}

/**
 * Verifies a token created by `createSignedToken` and returns its payload.
 *
 * Throws a `SignedTokenError` when the token is missing, was signed with a
 * different secret, has been tampered with, has expired, or was created for
 * a different `purpose`. The error's `code` says which.
 *
 * The token argument accepts `null` and `undefined` on purpose so a value
 * read straight from a query string or a header can be passed in as-is. A
 * missing token is a verification failure, never a skipped check.
 *
 * @example
 *
 *    const { organizationId, userId } = verifySignedToken<{
 *      organizationId: string
 *      userId: string
 *    }>(event.queryStringParameters?.state, {
 *      purpose: 'google-oauth-state',
 *    })
 */
export function verifySignedToken<
  TPayload extends object = Record<string, unknown>,
>(
  token: string | null | undefined,
  { purpose, secret }: VerifySignedTokenOptions,
): TPayload {
  assertPurpose(purpose)
  const resolvedSecret = resolveSecret(secret, 'verify')

  if (typeof token !== 'string' || token.length === 0) {
    throw new SignedTokenError('MISSING_TOKEN', 'No signed token was provided.')
  }

  let claims: unknown

  try {
    claims = jwt.verify(token, resolvedSecret, { algorithms: [ALGORITHM] })
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new SignedTokenError('EXPIRED', 'The signed token has expired.', e)
    }

    throw new SignedTokenError(
      'INVALID',
      'The signed token is invalid or was not created by this application.',
      e,
    )
  }

  if (!isSignedTokenClaims(claims)) {
    throw new SignedTokenError(
      'INVALID',
      'The signed token is invalid or was not created by this application.',
    )
  }

  if (claims.purpose !== purpose) {
    throw new SignedTokenError(
      'PURPOSE_MISMATCH',
      `The signed token was created for purpose '${claims.purpose}' but ` +
        `was verified with purpose '${purpose}'.`,
    )
  }

  // The signature has been verified with our own secret, so the payload is
  // whatever this application put there when it called `createSignedToken`.
  // TypeScript cannot know that shape; the caller names it via `TPayload`.
  return claims.payload as TPayload
}
