import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventQueryStringParameters,
  APIGatewayProxyResult,
  Context as LambdaContext,
} from 'aws-lambda'
import * as cookie from 'cookie'
import { parse } from 'picoquery'

import { getAuthenticationContext } from './auth/index.js'
import type { Decoder } from './auth/index.js'
import { requestToBaseEvent } from './transforms.js'

/**
 * A decoder that decodes nothing.
 *
 * Resolving `serverAuthState` has to happen before the GraphQL server reads
 * the request body:
 *
 * 1. Resolving it materialises the request body — `getAuthenticationContext`
 *    builds a Lambda-style event via `requestToBaseEvent`, which does
 *    `request.clone().text()`
 * 2. `clone()` only works while the body is untouched
 * 3. So once the GraphQL server has read the body, resolving throws
 *    `TypeError: unusable`
 *
 * `buildCedarContext` only resolves auth state when it's given a decoder, so
 * GraphQL call sites pass this one for projects that have no auth set up, to
 * keep the resolve eager. Resolving with it produces the same payload as
 * resolving with no decoders at all.
 *
 * (When it isn't resolved eagerly, `useRedwoodAuthContext` resolves it during
 * context building instead — too late. That's how this surfaces.)
 *
 * TODO: Remove this once the request body is captured at the entry point rather
 * than read lazily from the auth path, which drops the ordering constraint.
 */
export const noopAuthDecoder: Decoder = async () => null

export interface CedarRequestContext {
  params: Record<string, string>
  query: URLSearchParams
  cookies: ReadonlyMap<string, string>
  serverAuthState?: Awaited<ReturnType<typeof getAuthenticationContext>>
}

export type CedarHandler = (
  request: Request,
  ctx: CedarRequestContext,
) => Promise<Response> | Response

export type CedarMiddleware = (
  request: Request,
  ctx: CedarRequestContext,
  next: () => Promise<Response>,
) => Promise<Response>

export interface CedarRouteRecord {
  /**
   * Unique identifier for this route, typically the URL path (e.g. `/graphql`).
   * Used to derive the UD `EntryMeta.id`.
   */
  id: string
  path: string
  methods: string[]
  type: 'graphql' | 'auth' | 'function' | 'health'
  entry: string
}

export interface BuildCedarContextOptions {
  params?: Record<string, string>
  authDecoder?: Parameters<typeof getAuthenticationContext>[0]['authDecoder']
  lambdaContext?: LambdaContext
}

export interface LegacyHandlerContext {
  event: APIGatewayProxyEvent
  context: LambdaContext
  request: Request
  cedarContext: CedarRequestContext
}

export type LegacyHandlerResult = APIGatewayProxyResult | Response

export type LegacyHandler = (
  event: APIGatewayProxyEvent,
  context: LambdaContext,
) => Promise<LegacyHandlerResult> | LegacyHandlerResult

const DEFAULT_LAMBDA_CONTEXT: LambdaContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'cedar',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'cedar',
  memoryLimitInMB: '0',
  awsRequestId: 'cedar-request',
  logGroupName: 'cedar',
  logStreamName: 'cedar',
  getRemainingTimeInMillis() {
    return 0
  },
  done() {
    return undefined
  },
  fail() {
    return undefined
  },
  succeed() {
    return undefined
  },
}

function hasAuthDecoder(
  authDecoder: BuildCedarContextOptions['authDecoder'],
): authDecoder is NonNullable<BuildCedarContextOptions['authDecoder']> {
  if (Array.isArray(authDecoder)) {
    return authDecoder.length > 0
  }

  return !!authDecoder
}

export async function buildCedarContext(
  request: Request,
  options: BuildCedarContextOptions = {},
): Promise<CedarRequestContext> {
  const url = new URL(request.url)
  const query = url.searchParams
  const cookies: ReadonlyMap<string, string> = new Map(
    Object.entries(cookie.parse(request.headers.get('cookie') ?? '')).filter(
      (entry): entry is [string, string] => {
        return entry[1] !== undefined
      },
    ),
  )
  const params = options.params ?? {}

  // Only GraphQL consumes `serverAuthState`, and it's the only caller that
  // supplies an auth decoder — passing `noopAuthDecoder` when the project has
  // no auth set up. Computing it for plain function routes is wasted work —
  // without a decoder nothing can be decoded, so the payload could only ever
  // come back with `decoded` set to `null` — and it lets `Authorization`
  // header parse errors escape and turn requests to functions that don't use
  // auth at all into 500s.
  const serverAuthState = hasAuthDecoder(options.authDecoder)
    ? await getAuthenticationContext({
        authDecoder: options.authDecoder,
        event: request,
        context: options.lambdaContext,
      })
    : undefined

  return {
    params,
    query,
    cookies,
    serverAuthState,
  }
}

export function composeCedarMiddleware(
  handler: CedarHandler,
  middleware: CedarMiddleware[],
): CedarHandler {
  return middleware.reduceRight<CedarHandler>((next, current) => {
    return (request, ctx) => {
      return current(request, ctx, async () => next(request, ctx))
    }
  }, handler)
}

export function createRouteManifest(
  routes: CedarRouteRecord[],
): CedarRouteRecord[] {
  return routes.map((route) => {
    return {
      ...route,
      methods: [...route.methods],
    }
  })
}

export function routeManifestToJSON(routes: CedarRouteRecord[]): string {
  return JSON.stringify(createRouteManifest(routes), null, 2)
}

export function wrapLegacyHandler(
  legacyHandler: LegacyHandler,
  options: BuildCedarContextOptions = {},
): CedarHandler {
  return async (request, ctx) => {
    const lambdaContext = options.lambdaContext ?? DEFAULT_LAMBDA_CONTEXT
    const event = await requestToLegacyEvent(request, ctx)
    const result = await legacyHandler(event, lambdaContext)

    return legacyResultToResponse(result)
  }
}

export async function requestToLegacyEvent(
  request: Request,
  ctx: CedarRequestContext,
): Promise<APIGatewayProxyEvent> {
  const url = new URL(request.url)
  const base = await requestToBaseEvent(request)
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

  return {
    ...base,
    queryStringParameters,
    pathParameters:
      Object.keys(ctx.params).length > 0 ? ctx.params : base.pathParameters,
  }
}

export function legacyResultToResponse(result: LegacyHandlerResult): Response {
  if (result instanceof Response) {
    return result
  }

  const headers = new Headers()

  if (result.headers) {
    for (const [name, value] of Object.entries(result.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(name, item)
        }
      } else if (value !== undefined) {
        headers.set(name, String(value))
      }
    }
  }

  if (result.multiValueHeaders) {
    for (const [name, values] of Object.entries(result.multiValueHeaders)) {
      if (!values) {
        continue
      }

      for (const value of values) {
        headers.append(name, String(value))
      }
    }
  }

  const status = result.statusCode ?? 200

  // The `Response` constructor throws a TypeError if a "null body status" is
  // given a non-null body. Per the WHATWG Fetch spec those statuses are 101,
  // 103, 204, 205 and 304. The 1xx ones are unreachable here because the same
  // constructor throws a RangeError for any status outside 200-599.
  // See: https://fetch.spec.whatwg.org/#null-body-status and
  // https://fetch.spec.whatwg.org/#response-class ('If init["status"] is not in
  // the range 200 to 599, inclusive, then throw a RangeError.')
  const isNoBodyStatus = status === 204 || status === 205 || status === 304
  const body = isNoBodyStatus ? null : (result.body ?? '')

  if (result.isBase64Encoded && !isNoBodyStatus) {
    return new Response(Buffer.from(body || '', 'base64'), {
      status,
      headers,
    })
  }

  return new Response(body, {
    status,
    headers,
  })
}
