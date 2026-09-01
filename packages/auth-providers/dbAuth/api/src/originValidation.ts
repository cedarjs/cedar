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
   * Host (and port, if non-default) the request was sent to, resolved with
   * {@link resolveRequestHost}. Used to allow same-origin requests through
   * with no extra configuration, which covers the standard Cedar setup
   * where the web side proxies API requests through its own origin. Pass
   * `null` when the host can't be determined.
   */
  host?: string | null
  /**
   * Scheme (`http`/`https`) the request is considered to have arrived
   * over, resolved with {@link resolveRequestProtocol}, when it can be
   * determined reliably. Used as an extra check alongside `host` when
   * deciding whether the `Origin` header matches the request's own
   * origin. Pass `null`/`undefined` when it can't be determined -- in that
   * case only the host is compared.
   */
  protocol?: string | null
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

function firstForwardedValue(headerValue: string): string {
  // A chain of proxies appends its own entry to a forwarded header; the
  // first one is the one closest to the original client
  return headerValue.split(',')[0].trim()
}

/**
 * Resolves the host a request should be considered as having arrived at,
 * preferring a forwarding proxy's advertised host over the connection-level
 * one.
 *
 * A proxy in front of the api side (this framework's own `cedar serve
 * --ud`, or an external nginx/CDN) terminates the browser's connection and
 * opens a new one to the api server, so the request's own URL/`Host` header
 * reflects that internal hop rather than the origin-facing host the
 * browser actually targeted. `X-Forwarded-Host` carries the origin-facing
 * host instead.
 *
 * Trusting `X-Forwarded-Host` here is safe for CSRF purposes: a cross-site
 * HTML form can't set arbitrary request headers, and a cross-origin
 * `fetch()` that sets a custom header triggers a CORS preflight, so an
 * attacker can't forge it without already having crossed the browser's
 * CORS checks.
 *
 * @param url - The request's own URL (Fetch API requests only), used as a
 * fallback when neither `X-Forwarded-Host` nor `Host` is present.
 */
export function resolveRequestHost(
  headers: Headers,
  url?: string | null,
): string | null {
  const forwardedHost = headers.get('x-forwarded-host')
  if (forwardedHost) {
    return firstForwardedValue(forwardedHost)
  }

  const host = headers.get('host')
  if (host) {
    return host
  }

  if (url) {
    try {
      return new URL(url).host
    } catch {
      return null
    }
  }

  return null
}

/**
 * Resolves the scheme (`http`/`https`) a request should be considered as
 * having arrived over, mirroring {@link resolveRequestHost}.
 *
 * The request's own URL is only used as a fallback when no
 * `X-Forwarded-Host` is present -- once a proxy has declared itself by
 * setting that header, the request's own URL reflects the internal hop to
 * the proxy, and its scheme can't be assumed to match what the browser
 * actually used unless the proxy also set `X-Forwarded-Proto`.
 *
 * @param url - The request's own URL (Fetch API requests only).
 */
export function resolveRequestProtocol(
  headers: Headers,
  url?: string | null,
): string | null {
  const forwardedProto = headers.get('x-forwarded-proto')
  if (forwardedProto) {
    return firstForwardedValue(forwardedProto).toLowerCase()
  }

  if (!headers.get('x-forwarded-host') && url) {
    try {
      return new URL(url).protocol.replace(':', '')
    } catch {
      return null
    }
  }

  return null
}

function isSameOrigin(
  origin: string,
  host: string,
  protocol?: string | null,
): boolean {
  try {
    const originUrl = new URL(origin)
    if (originUrl.host !== host) {
      return false
    }

    // Scheme is only compared when it's reliably known (see
    // `resolveRequestProtocol`); host-only matching is still a strong CSRF
    // check on its own, since `Origin` already includes the host
    return !protocol || originUrl.protocol === `${protocol}:`
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

  if (request.host && isSameOrigin(origin, request.host, request.protocol)) {
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
