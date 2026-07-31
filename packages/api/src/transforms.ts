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

const capturedBodies = new WeakMap<Request, string>()

/**
 * Remember a request's body text, so that Lambda-style events can still be
 * built from it after the body stream has been consumed.
 *
 * A `Request` body is a single-use stream: `clone()` throws
 * `TypeError: unusable` once anything has read it. Anything that converts a
 * `Request` into a Lambda-style event later in the request lifecycle — auth
 * state resolution, legacy handler invocation — therefore depends on the body
 * having been captured up front.
 *
 * Call this at the point a request enters Cedar, before anything reads the
 * body. Use this overload when the caller already holds the body text — as
 * both Fastify entry points do — so that the stream is never read at all. Use
 * {@link captureRequestBodyByCloning} when it doesn't.
 */
export const captureRequestBody = (request: Request, body: string): void => {
  capturedBodies.set(request, body)
}

/**
 * {@link captureRequestBody} for entry points that are handed a `Request` they
 * didn't build, and so have to read the body from a clone to capture it.
 *
 * Must be called before anything else reads the body. A request whose body has
 * already been consumed can't be captured, and is left for `readRequestBody`
 * to report.
 */
export const captureRequestBodyByCloning = async (
  request: Request,
): Promise<void> => {
  if (capturedBodies.has(request)) {
    return
  }

  try {
    capturedBodies.set(request, await request.clone().text())
  } catch {
    // Already consumed
  }
}

/**
 * The captured body if there is one, otherwise a best-effort read from a
 * clone. Returns null rather than throwing when the body has been consumed and
 * was never captured, so that a late conversion degrades to an event with no
 * body instead of taking the whole request down.
 */
const readRequestBody = async (request: Request): Promise<string | null> => {
  const captured = capturedBodies.get(request)

  if (captured !== undefined) {
    return captured
  }

  try {
    return await request.clone().text()
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        'Building a Lambda-style event for a request whose body has already ' +
          'been read, and which was not captured when it entered Cedar. ' +
          '`event.body` will be null. Call `captureRequestBody` at the entry ' +
          'point to fix this.',
      )
    }

    return null
  }
}

export const requestToBaseEvent = async (
  request: Request,
): Promise<APIGatewayProxyEvent> => {
  const url = new URL(request.url)
  const bodyText = await readRequestBody(request)
  const queryStringParameters: Record<string, string> = {}

  url.searchParams.forEach((value, key) => {
    queryStringParameters[key] = value
  })

  const event = {
    headers: Object.fromEntries(request.headers.entries()),
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

// Internal note:  Equivalent to dnull package on npm, which seems to have import issues in latest versions

/**
 * Useful for removing nulls from an object, such as an input from a GraphQL mutation used directly in a Prisma query
 * @param input - Object to remove nulls from
 * See {@link https://www.prisma.io/docs/concepts/components/prisma-client/null-and-undefined Prisma docs: null vs undefined}
 */
export const removeNulls = (input: Record<number | symbol | string, any>) => {
  for (const key in input) {
    if (input[key] === null) {
      input[key] = undefined
    } else if (
      typeof input[key] === 'object' &&
      !(input[key] instanceof Date) // dates are objects too
    ) {
      // Note arrays are also typeof object!
      input[key] = removeNulls(input[key])
    }
  }

  return input
}
