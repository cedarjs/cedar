import { Headers, Request as PonyfillRequest } from '@whatwg-node/fetch'
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventQueryStringParameters,
} from 'aws-lambda'
import { parse } from 'picoquery'

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
  // @ts-expect-error - picoquery returns nested objects and arrays for
  // bracket-notation params (e.g. ids[]=1&ids[]=2, user[name]=alice).
  // APIGatewayProxyEventQueryStringParameters is too narrow for this richer
  // structure, but legacy handlers depend on it.
  const queryStringParameters: APIGatewayProxyEventQueryStringParameters =
    parse(url.search ? url.search.slice(1) : '', {
      nestingSyntax: 'index',
      arrayRepeat: true,
      arrayRepeatSyntax: 'bracket',
    })

  const event = {
    headers: Object.fromEntries(request.headers.entries()),
    body: bodyText || null,
    httpMethod: request.method,
    path: url.pathname,
    queryStringParameters:
      Object.keys(queryStringParameters).length > 0
        ? queryStringParameters
        : null,
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
