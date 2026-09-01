import type { CorsConfig } from '@cedarjs/api'

/**
 * Minimal, transport-agnostic shape of an incoming request needed to decide
 * whether its `Origin` header should be trusted for a state-changing
 * request. Deliberately decoupled from any specific request/event type (no
 * `DbAuthHandler` coupling) so this helper can be reused by other handler
 * packages.
 */
export interface OriginValidationRequest {
  /**
   * HTTP method of the request, e.g. `GET`, `POST`. Used by
   * {@link requiresOriginValidation} to decide whether a request needs to be
   * checked at all.
   */
  method: string
  /**
   * Request headers, including `origin` if the browser sent one.
   */
  headers: Headers
  /**
   * Host (and port, if non-default) the request was sent to. Either the
   * request's own URL host (Fetch API requests) or its `Host` /
   * `X-Forwarded-Host` header (Lambda-style events). Used to allow
   * same-origin requests through with no extra configuration, which covers
   * the standard Cedar setup where the web side proxies API requests
   * through its own origin. Pass `null` when the host can't be determined.
   */
  host?: string | null
}

export interface OriginValidationConfig {
  /**
   * Extra origins that are always trusted for state-changing requests, on
   * top of the request's own host and any origins already listed in
   * `cors.origin`.
   */
  trustedOrigins?: string | string[]
  /**
   * The `origin` value from a handler's `cors` config (same shape as passed
   * to `createCorsContext`). String and array values are treated as
   * trusted origins.
   *
   * `true` (reflect any request origin back in
   * `Access-Control-Allow-Origin`) is intentionally NOT treated as trust --
   * combined with `credentials: true` that is the exact misconfiguration
   * this check protects against. Apps that need to accept requests from an
   * arbitrary set of origins must list them explicitly in `trustedOrigins`
   * instead.
   */
  corsOrigin?: CorsConfig['origin']
}

/**
 * HTTP methods that can change server-side state and therefore need their
 * `Origin` validated. `GET` and `HEAD` requests are read-only and are never
 * checked.
 */
export function requiresOriginValidation(method: string): boolean {
  const upperMethod = method.toUpperCase()
  return upperMethod !== 'GET' && upperMethod !== 'HEAD'
}

function toOriginList(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function isSameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host
  } catch {
    // `origin` wasn't a valid absolute URL -- treat it as untrusted rather
    // than throwing
    return false
  }
}

/**
 * Decides whether a request's `Origin` header should be trusted.
 *
 * Requests with no `Origin` header are always trusted: non-browser clients
 * (server-to-server calls, CLIs, mobile apps) don't send one and don't carry
 * ambient browser cookies, so they aren't CSRF vectors.
 *
 * When an `Origin` header is present, it's trusted when it matches the
 * request's own host, is listed in `trustedOrigins`, or is listed in
 * `corsOrigin`. Everything else is untrusted.
 */
export function isRequestOriginTrusted(
  request: OriginValidationRequest,
  config: OriginValidationConfig,
): boolean {
  const origin = request.headers.get('origin')

  if (!origin) {
    return true
  }

  if (request.host && isSameOrigin(origin, request.host)) {
    return true
  }

  const trustedOrigins = toOriginList(config.trustedOrigins)
  if (trustedOrigins.includes(origin)) {
    return true
  }

  const corsOrigins = toOriginList(
    typeof config.corsOrigin === 'string' || Array.isArray(config.corsOrigin)
      ? config.corsOrigin
      : undefined,
  )
  if (corsOrigins.includes(origin)) {
    return true
  }

  return false
}
