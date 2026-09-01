import type { APIGatewayProxyEvent } from 'aws-lambda'

import { isFetchApiRequest } from '@cedarjs/api'

import type { OAuthFlow } from './types.js'

export interface NormalizedOAuthRequest {
  method: string
  /** URL pathname, e.g. `/auth/oauth/google/callback`. */
  path: string
  headers: Headers
  query: Record<string, string>
  /** Parsed `application/x-www-form-urlencoded` body, present on POST callbacks. */
  form: Record<string, string>
}

function parseFormBody(text: string): Record<string, string> {
  const form: Record<string, string> = {}

  new URLSearchParams(text).forEach((value, key) => {
    form[key] = value
  })

  return form
}

function isFormUrlEncoded(headers: Headers): boolean {
  const contentType = headers.get('content-type') ?? ''
  return contentType.toLowerCase().includes('application/x-www-form-urlencoded')
}

async function normalizeFetchRequest(
  event: Request,
): Promise<NormalizedOAuthRequest> {
  const url = new URL(event.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  let form: Record<string, string> = {}
  if (isFormUrlEncoded(event.headers)) {
    const text = await event.text()
    form = text ? parseFormBody(text) : {}
  }

  return {
    method: event.method,
    path: url.pathname,
    headers: event.headers,
    query,
    form,
  }
}

function decodeLambdaBody(event: APIGatewayProxyEvent): string {
  if (!event.body) {
    return ''
  }

  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body
}

function compactQueryParams(
  params: Record<string, string | undefined> | null | undefined,
): Record<string, string> {
  const query: Record<string, string> = {}

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) {
      query[key] = value
    }
  }

  return query
}

function normalizeLambdaRequest(
  event: APIGatewayProxyEvent,
): NormalizedOAuthRequest {
  const headers = new Headers(event.headers as Record<string, string>)

  let form: Record<string, string> = {}
  if (isFormUrlEncoded(headers)) {
    const text = decodeLambdaBody(event)
    form = text ? parseFormBody(text) : {}
  }

  return {
    method: event.httpMethod,
    path: event.path,
    headers,
    query: compactQueryParams(event.queryStringParameters),
    form,
  }
}

/**
 * Normalizes a Lambda-style event or a Fetch `Request` into the subset of
 * fields the OAuth handler needs. Unlike `@cedarjs/api`'s `normalizeRequest`
 * (which always JSON-parses the body), this also handles
 * `application/x-www-form-urlencoded` bodies — required for `form_post`
 * callbacks (Apple-shaped providers POST the callback as a form, not JSON).
 */
export async function normalizeOAuthRequest(
  event: APIGatewayProxyEvent | Request,
): Promise<NormalizedOAuthRequest> {
  if (isFetchApiRequest(event)) {
    return normalizeFetchRequest(event)
  }

  return normalizeLambdaRequest(event)
}

export interface OAuthRoute {
  provider: string
  action: 'authorize' | 'callback' | 'unlink'
}

/**
 * Trims trailing `/` characters with a plain index scan rather than a regex.
 * `basePath` is app-configured, but `path` (trimmed the same way below) is
 * attacker-controlled request input, and a regex-based trim on unbounded
 * input risks catastrophic backtracking.
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') {
    end--
  }
  return value.slice(0, end)
}

/**
 * Trims leading `/` characters with a plain index scan, for the same reason
 * `trimTrailingSlashes` avoids a regex.
 */
function trimLeadingSlashes(value: string): string {
  let start = 0
  while (start < value.length && value[start] === '/') {
    start++
  }
  return value.slice(start)
}

/**
 * Parses `{basePath}/{provider}/{action}` out of a request path. Returns
 * `null` when the path doesn't match a recognized OAuth route (the caller
 * should treat that as a 404).
 */
export function parseOAuthRoute(
  path: string,
  basePath: string,
): OAuthRoute | null {
  const normalizedBase = trimTrailingSlashes(basePath)

  if (!path.startsWith(normalizedBase)) {
    return null
  }

  // `startsWith` alone isn't a route boundary: without this check a path
  // like `/auth/oauthgoogle/authorize` would match a `basePath` of
  // `/auth/oauth` too, parsing out a bogus provider name (`google`). The
  // character right after `normalizedBase` must be a `/` (the start of the
  // `{provider}/{action}` segment), or the path must equal `normalizedBase`
  // exactly.
  const boundaryChar = path[normalizedBase.length]
  if (boundaryChar !== undefined && boundaryChar !== '/') {
    return null
  }

  const rest = trimLeadingSlashes(path.slice(normalizedBase.length))
  const segments = rest.split('/').filter(Boolean)

  if (segments.length !== 2) {
    return null
  }

  const [provider, action] = segments

  if (action !== 'authorize' && action !== 'callback' && action !== 'unlink') {
    return null
  }

  return { provider, action }
}

/**
 * Reads the `flow` query param off an `/authorize` request. Defaults to
 * `'login'`. Anything other than `login`/`signup`/`link` is treated as
 * `login` too — `authorize` never accepts `unlink` as a flow.
 */
export function parseAuthorizeFlow(
  query: Record<string, string>,
): Extract<OAuthFlow, 'login' | 'signup' | 'link'> {
  const flow = query.flow

  if (flow === 'signup' || flow === 'link') {
    return flow
  }

  return 'login'
}
