import { v4 as uuidv4 } from 'uuid'

import { encryptSession, generateCookieName } from './shared.js'

/**
 * Cookie attributes that can be set on a dbAuth cookie, either as
 * `cookie.attributes` or (deprecated) directly on `cookie`.
 */
export interface DbAuthCookieAttributes {
  Path?: string
  HttpOnly?: boolean
  Secure?: boolean
  SameSite?: string
  Domain?: string
}

/**
 * Configuration for the cookies dbAuth sets: the session cookie's name, and
 * the attributes applied to every cookie dbAuth writes (the session cookie
 * and the `auth-provider` cookie).
 */
export interface DbAuthCookieConfig extends DbAuthCookieAttributes {
  attributes?: DbAuthCookieAttributes
  /**
   * The name of the cookie that dbAuth sets
   *
   * %port% will be replaced with the port the api server is running on.
   * If you have multiple RW apps running on the same host, you'll need to
   * make sure they all use unique cookie names
   */
  name?: string
}

// default to epoch when we want to expire
const PAST_EXPIRES_DATE = new Date(
  '1970-01-01T00:00:00.000+00:00',
).toUTCString()

/**
 * Returns a UTC date string `expiresInSeconds` seconds in the future. Used as
 * the `Expires` cookie attribute for a session that should stay valid for
 * that long from now.
 */
export function createExpiresAtDate(expiresInSeconds: number): string {
  const expiresAt = new Date()
  expiresAt.setSeconds(expiresAt.getSeconds() + expiresInSeconds)

  return expiresAt.toUTCString()
}

/**
 * Generates a new CSRF token (a standard UUID) to pair with a session.
 */
export function createCsrfToken(): string {
  return uuidv4()
}

/**
 * Removes any fields not explicitly allowed to be sent to the client before
 * sending a user record over the wire.
 */
export function sanitizeUser(
  user: Record<string, unknown>,
  allowedUserFields: string[],
): Record<string, unknown> {
  const sanitized = JSON.parse(JSON.stringify(user))

  Object.keys(sanitized).forEach((key) => {
    if (!allowedUserFields.includes(key)) {
      delete sanitized[key]
    }
  })

  return sanitized
}

/**
 * Builds the Set-Cookie attribute strings (`Path`, `HttpOnly`, `SameSite`,
 * `Secure`, `Domain`, `Expires`) for a dbAuth cookie.
 *
 * Pass `expires: 'now'` (the default) to get the attributes needed to expire
 * the cookie, or a UTC date string (e.g. from `createExpiresAtDate`) to set a
 * future expiration.
 */
export function buildCookieAttributes({
  cookieConfig,
  expires = 'now',
  overrideAttributes = {},
}: {
  cookieConfig?: DbAuthCookieConfig
  expires?: 'now' | string
  overrideAttributes?: DbAuthCookieAttributes
}): string[] {
  // TODO: When we drop support for specifying cookie attributes directly on
  // `cookieConfig` we can get rid of all of this and just spread
  // `cookieConfig?.attributes` directly into `cookieOptions` below
  const userCookieAttributes: DbAuthCookieConfig = cookieConfig?.attributes
    ? { ...cookieConfig.attributes }
    : { ...cookieConfig }

  if (!cookieConfig?.attributes) {
    delete userCookieAttributes.name
  }

  const cookieOptions = { ...userCookieAttributes, ...overrideAttributes }

  const meta = Object.keys(cookieOptions)
    .map((key) => {
      const optionValue = cookieOptions[key as keyof typeof cookieOptions]

      // Convert the options to valid cookie string
      if (optionValue === true) {
        return key
      } else if (optionValue === false) {
        return null
      } else {
        return `${key}=${optionValue}`
      }
    })
    .filter((v): v is string => v !== null)

  const expiresAt = expires === 'now' ? PAST_EXPIRES_DATE : expires
  meta.push(`Expires=${expiresAt}`)

  return meta
}

/**
 * Builds the Set-Cookie header string for the `auth-provider` cookie dbAuth
 * sets alongside the session cookie.
 */
export function createAuthProviderCookieString({
  cookieConfig,
  expiresAt,
}: {
  cookieConfig?: DbAuthCookieConfig
  expiresAt: string
}): string {
  return [
    `auth-provider=dbAuth`,
    ...buildCookieAttributes({ cookieConfig, expires: expiresAt }),
  ].join(';')
}

/**
 * Builds the Set-Cookie header string for the dbAuth session cookie: the
 * `data;csrfToken` payload, encrypted, under the configured cookie name and
 * attributes.
 */
export function createSessionCookieString<TIdType = unknown>({
  data,
  csrfToken,
  cookieConfig,
  expiresAt,
}: {
  data: Record<string, TIdType>
  csrfToken: string
  cookieConfig?: DbAuthCookieConfig
  expiresAt: string
}): string {
  const session = JSON.stringify(data) + ';' + csrfToken
  const encrypted = encryptSession(session)

  return [
    `${generateCookieName(cookieConfig?.name)}=${encrypted}`,
    ...buildCookieAttributes({ cookieConfig, expires: expiresAt }),
  ].join(';')
}

/** Fields returned from the user record when none are explicitly allowed */
export const DEFAULT_ALLOWED_USER_FIELDS = ['id', 'email']

export interface CreateLoginResponseOptions {
  /**
   * Object containing cookie config options: the cookie name (with %port%
   * support) and the attributes applied to it (`Path`, `HttpOnly`,
   * `SameSite`, `Secure`, `Domain`).
   */
  cookie?: DbAuthCookieConfig
  /**
   * The fields that are allowed to be returned from the user record.
   * Defaults to `id` and `email`.
   */
  allowedUserFields?: string[]
  /**
   * The `Expires` cookie attribute value for the session and `auth-provider`
   * cookies: a UTC date string in the future. Build one with
   * `createExpiresAtDate(expiresInSeconds)`.
   */
  expiresAt: string
  /**
   * The HTTP status code to return in the response tuple. Defaults to 200.
   */
  statusCode?: number
}

/**
 * Mints a dbAuth session for the given user: a CSRF token, a session cookie
 * (the sanitized user data paired with the CSRF token, encrypted), and the
 * `auth-provider` cookie, in the same `[body, headers, { statusCode }]` shape
 * every dbAuth auth method returns.
 *
 * Callable without a `DbAuthHandler` instance, so any code that has already
 * verified a user's identity — a WebAuthn assertion, an OAuth callback, a
 * magic link — can issue a session the same way the built-in login flow
 * does.
 */
export function createLoginResponse(
  user: Record<string, unknown>,
  options: CreateLoginResponseOptions,
): [Record<string, unknown>, Headers, { statusCode: number }] {
  const allowedUserFields =
    options.allowedUserFields ?? DEFAULT_ALLOWED_USER_FIELDS
  const sessionData = sanitizeUser(user, allowedUserFields)

  // TODO: this needs to go into graphql somewhere so that each request makes
  // a new CSRF token and sets it in both the encrypted session and the
  // csrf-token header
  const csrfToken = createCsrfToken()

  const headers = new Headers()

  headers.append('csrf-token', csrfToken)
  headers.append(
    'set-cookie',
    createAuthProviderCookieString({
      cookieConfig: options.cookie,
      expiresAt: options.expiresAt,
    }),
  )
  headers.append(
    'set-cookie',
    createSessionCookieString({
      data: sessionData,
      csrfToken,
      cookieConfig: options.cookie,
      expiresAt: options.expiresAt,
    }),
  )

  return [sessionData, headers, { statusCode: options.statusCode ?? 200 }]
}
