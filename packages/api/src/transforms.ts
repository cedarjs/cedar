import { Headers, Request as PonyfillRequest } from '@whatwg-node/fetch'
import type { APIGatewayProxyEvent } from 'aws-lambda'

// This is part of the request, dreived either from a LambdaEvent or FetchAPI Request
// We do this to keep the API consistent between the two
// When we support only the FetchAPI request, we should remove this
export interface PartialRequest<TBody = Record<string, any>> {
  jsonBody: TBody
  headers: Headers
  method: string
  query: any
}

/**
 * Extracts and parses body payload from event with base64 encoding check
 */
export const parseLambdaEventBody = (event: APIGatewayProxyEvent) => {
  if (!event.body) {
    return {}
  }

  if (event.isBase64Encoded) {
    return JSON.parse(Buffer.from(event.body, 'base64').toString('utf-8'))
  } else {
    return JSON.parse(event.body)
  }
}

/**
 * Extracts and parses body payload from Fetch Request
 * with check for empty body
 *
 * NOTE: whatwg/server expects that you will decode the base64 body yourself
 * see readme here: https://github.com/ardatan/whatwg-node/tree/master/packages/server#aws-lambda
 */
export const parseFetchEventBody = async (event: Request) => {
  if (!event.body) {
    return {}
  }

  const body = await event.text()

  return body ? JSON.parse(body) : {}
}

export const requestToBaseEvent = async (
  request: Request,
): Promise<APIGatewayProxyEvent> => {
  const url = new URL(request.url)
  const bodyText = await request.clone().text()
  const queryStringParameters: Record<string, string> = {}

  url.searchParams.forEach((value, key) => {
    queryStringParameters[key] = value
  })

  const headers = Object.fromEntries(request.headers.entries())

  // A Lambda-style event has no URL of its own, so once this event is
  // built, the request's scheme survives only as a forwarded header.
  // Backfill it from the Fetch API request's own URL when the caller
  // hasn't already set one (e.g. a proxy that already forwarded it).
  if (!headers['x-forwarded-proto']) {
    headers['x-forwarded-proto'] = url.protocol.replace(':', '')
  }

  const event = {
    headers,
    body: bodyText || null,
    httpMethod: request.method,
    path: url.pathname,
    queryStringParameters,
    isBase64Encoded: false,
    multiValueHeaders: toMultiValueHeaders(request.headers),
    multiValueQueryStringParameters: toMultiValueQueryStringParameters(url),
    pathParameters: null,
    stageVariables: null,
    resource: url.pathname,
    requestContext: {
      accountId: 'cedar',
      apiId: 'cedar',
      authorizer: undefined,
      protocol: 'HTTP/1.1',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '',
        user: null,
        userAgent: request.headers.get('user-agent'),
        userArn: null,
      },
      path: url.pathname,
      stage: '',
      requestId: 'cedar-request',
      requestTimeEpoch: Date.now(),
      resourceId: 'cedar',
      resourcePath: url.pathname,
      httpMethod: request.method,
    },
  }

  return event
}

function toMultiValueHeaders(headers: Headers): Record<string, string[]> {
  const values = new Map<string, string[]>()

  for (const [name, value] of headers.entries()) {
    const existing = values.get(name) ?? []
    existing.push(value)
    values.set(name, existing)
  }

  if (values.size === 0) {
    return {}
  }

  return Object.fromEntries(values.entries())
}

function toMultiValueQueryStringParameters(
  url: URL,
): Record<string, string[]> | null {
  const values = new Map<string, string[]>()

  for (const [name, value] of url.searchParams.entries()) {
    const existing = values.get(name) ?? []
    existing.push(value)
    values.set(name, existing)
  }

  if (values.size === 0) {
    return null
  }

  return Object.fromEntries(values.entries())
}

export const isFetchApiRequest = (
  event: Request | APIGatewayProxyEvent,
): event is Request => {
  if (
    event.constructor.name === 'Request' ||
    event.constructor.name === PonyfillRequest.name
  ) {
    return true
  }

  // Also do an extra check on type of headers
  if (Symbol.iterator in Object(event.headers)) {
    return true
  }

  return false
}

function getQueryStringParams(reqUrl: string) {
  const url = new URL(reqUrl)
  const params = new URLSearchParams(url.search)

  const paramObject: Record<string, string> = {}
  for (const entry of params.entries()) {
    paramObject[entry[0]] = entry[1] // each 'entry' is a [key, value] tuple
  }
  return paramObject
}

/**
 *
 * This function returns a an object that lets you access _some_ of the request properties in a consistent way
 * You can give it either a LambdaEvent or a Fetch API Request
 *
 * NOTE: It does NOT return a full Request object!
 */
export async function normalizeRequest(
  event: APIGatewayProxyEvent | Request,
): Promise<PartialRequest> {
  if (isFetchApiRequest(event)) {
    return {
      headers: event.headers,
      method: event.method,
      query: getQueryStringParams(event.url),
      jsonBody: await parseFetchEventBody(event),
    }
  }

  const jsonBody = parseLambdaEventBody(event)

  return {
    headers: new Headers(event.headers as Record<string, string>),
    method: event.httpMethod,
    query: event.queryStringParameters,
    jsonBody,
  }
}

/**
 * The type of `T` after `removeNulls`: each field that can be `null` can be
 * `undefined` instead.
 */
export type RemoveNulls<T> = {
  [K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K]
}

/**
 * Returns a copy of `input` with every `null` field set to `undefined`.
 *
 * GraphQL input types make every field nullable, but Prisma doesn't accept
 * `null` for required fields. `undefined` leaves the field unchanged, so this
 * lets you pass a GraphQL mutation input straight to Prisma:
 *
 * ```ts
 * db.post.update({ data: removeNulls(input), where: { id } })
 * ```
 *
 * Only top-level fields are changed. Nested objects, such as `Json` field
 * values, are passed through as they are.
 *
 * See {@link https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/null-and-undefined Prisma docs: null vs undefined}
 */
export function removeNulls<T extends object>(input: T): RemoveNulls<T> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    result[key] = value === null ? undefined : value
  }

  // Every null value is now undefined, which is what RemoveNulls<T> describes
  return result as RemoveNulls<T>
}
