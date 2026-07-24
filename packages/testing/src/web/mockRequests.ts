// MSW is used by Jest (NodeJS), Vitest and Storybook
import { bypass, delay, graphql, HttpResponse } from 'msw'
import type { RequestHandler, SharedOptions } from 'msw'
import type { StartOptions as StartMSWWorkerOptions } from 'msw/browser'

// The APIs returned by `setupWorker()` (msw/browser) and `setupServer()`
// (msw/node) resolve to ESM- or CJS-flavored type declarations depending on
// which build of this package is being produced, and the two declaration sets
// are nominally incompatible (they contain classes with protected members).
// We only use this small, structurally-identical surface, so we declare it
// locally. The handlers are typed `any` because the two flavors of msw's
// `RequestHandler` can't be unified either
interface MockServerCommonApi {
  use(...handlers: any[]): void
  resetHandlers(): void
}
type MockWorkerInstance = MockServerCommonApi & { stop(): void }
type MockServerInstance = MockServerCommonApi & {
  listen(options?: Partial<SharedOptions>): void
  close(): void
}

// Allow users to call "mockGraphQLQuery" and "mockGraphQLMutation"
// before the server has started. We store the request handlers in
// a queue that is drained once the server is started.
let REQUEST_HANDLER_QUEUE: RequestHandler[] = []
let SERVER_INSTANCE: MockWorkerInstance | MockServerInstance | undefined

/**
 * Plugs fetch for the correct target in order to capture requests.
 *
 * Request handlers can be registered lazily (via `mockGraphQL<Query|Mutation>`),
 * the queue will be drained and used.
 */

// Assigned to a variable so bundlers can't statically resolve the dynamic
// import below. See the comment at its call site.
const MSW_NODE_SPECIFIER = 'msw/node'

type StartOptions<Target> = Target extends 'browsers'
  ? StartMSWWorkerOptions
  : Partial<SharedOptions>
export const startMSW = async <Target extends 'node' | 'browsers'>(
  target: Target,
  options?: StartOptions<Target>,
) => {
  if (SERVER_INSTANCE) {
    return SERVER_INSTANCE
  }

  if (target === 'browsers') {
    const { setupWorker } = await import('msw/browser')
    const worker = setupWorker()
    SERVER_INSTANCE = worker
    await worker.start(options)
  } else {
    // Keep this specifier opaque to static analysis. Bundling this module for
    // the browser (Storybook, Vitest browser mode) would otherwise make
    // Vite/Rollup resolve `msw/node`, and MSW's Node-only dependencies mark
    // their browser entries as `"browser": null`, so resolution hard-fails
    // with `No known conditions for "./ClientRequest"` — even though the
    // browser never reaches this branch.
    const { setupServer } = (await import(
      /* @vite-ignore */ MSW_NODE_SPECIFIER
    )) as { setupServer: () => MockServerInstance }

    const server = setupServer()
    SERVER_INSTANCE = server
    server.listen(options)
  }

  return SERVER_INSTANCE
}

export const setupRequestHandlers = () => {
  SERVER_INSTANCE?.resetHandlers()
  // Register all the handlers that are stored in the queue.
  for (const handler of REQUEST_HANDLER_QUEUE) {
    SERVER_INSTANCE?.use(handler)
  }
}

export const closeServer = () => {
  if (!SERVER_INSTANCE) {
    return
  }

  if ('close' in SERVER_INSTANCE) {
    SERVER_INSTANCE.close()
  } else {
    SERVER_INSTANCE.stop()
  }

  // Clear the instance so that a later `startMSW()` call starts a fresh
  // server instead of returning the closed one. This matters when the same
  // module instance is reused across test files, like when running Vitest
  // with `isolate: false`.
  // `REQUEST_HANDLER_QUEUE` is deliberately NOT cleared here: it holds the
  // "global" handlers (cell mocks and `mockGraphQL*` calls made before the
  // server started) that `setupRequestHandlers()` re-registers after every
  // test. When the module instance is reused across test files, the module
  // cache also prevents cell mock files from re-registering on re-import, so
  // clearing the queue would permanently lose those global mocks
  SERVER_INSTANCE = undefined
}

export const registerHandler = (handler: RequestHandler) => {
  if (!SERVER_INSTANCE) {
    // The server hasn't started yet, so add the request handler to the queue.
    // The queue will be drained once the server has started.
    REQUEST_HANDLER_QUEUE = [...REQUEST_HANDLER_QUEUE, handler]
  } else {
    SERVER_INSTANCE.use(handler)
  }
}

/**
 * The `ctx` object passed to mock-data functions. It mirrors the API of MSW
 * v1's GraphQL context so that existing Cedar mocks keep working with MSW v2,
 * where the `(req, res, ctx)` resolver signature no longer exists.
 */
export interface MockGraphQLContext {
  /** Set the http response status code (and optionally status text) */
  status(code: number, text?: string): void
  /** Delay the response by the given number of milliseconds */
  delay(durationMs: number): void
  /** Return GraphQL errors in the response */
  errors(errorList: Record<string, unknown>[]): void
  /** Set a response header. Accepts a name/value pair or an object */
  set(name: string | Record<string, string>, value?: string): void
  /** Set a response cookie */
  cookie(name: string, value: string): void
  /** Set the `extensions` field of the GraphQL response */
  extensions(extensions: Record<string, unknown>): void
  /** Set an arbitrary field on the GraphQL response body */
  field(fieldName: string, value: unknown): void
  /** Set the `data` field of the response. Overrides the returned mock-data */
  data(data: Record<string, unknown>): void
  /** Perform a request that bypasses any mock handlers */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
}

/**
 * Information about the intercepted GraphQL request, passed to mock-data
 * functions as `req`
 */
export interface MockGraphQLRequest {
  /** The intercepted Fetch API `Request` */
  request: Request
  /** The GraphQL query document string */
  query: string
  operationName: string
  variables: Record<string, any>
  cookies: Record<string, string>
  url: URL
  headers: Headers
  method: string
}

export type DataFunction<
  Query extends Record<string, unknown> = Record<string, unknown>,
  QueryVariables = Record<string, any>,
> = (
  variables: QueryVariables,
  {
    req,
    ctx,
  }: {
    req: MockGraphQLRequest
    ctx: MockGraphQLContext
  },
) => Query | void | Promise<Query | void>

type ResponseEnhancer = 'once' | 'networkError'

const mockGraphQL = (
  type: 'query' | 'mutation',
  operation: string,
  data: DataFunction | Record<string, any>,
  responseEnhancer?: ResponseEnhancer,
) => {
  const resolver = async ({
    request,
    query,
    operationName,
    variables,
    cookies,
  }: {
    request: Request
    query: string
    operationName: string
    variables: Record<string, any>
    cookies: Record<string, string>
  }) => {
    let d: Record<string, any> | void = undefined
    // Values captured by the `ctx` compatibility object below
    let status = 200
    let statusText: string | undefined
    let delayDurationMs: number | undefined
    let errorList: Record<string, unknown>[] | undefined
    let extensions: Record<string, unknown> | undefined
    let explicitData: Record<string, unknown> | undefined
    const extraFields: Record<string, unknown> = {}
    const headers = new Headers()

    if (typeof data === 'function') {
      const ctx: MockGraphQLContext = {
        status: (code, text) => {
          status = code
          statusText = text
        },
        delay: (durationMs) => {
          delayDurationMs = durationMs
        },
        errors: (errors) => {
          errorList = errors
        },
        set: (name, value) => {
          if (typeof name === 'object') {
            for (const [headerName, headerValue] of Object.entries(name)) {
              headers.set(headerName, headerValue)
            }
          } else if (typeof value !== 'undefined') {
            headers.set(name, value)
          }
        },
        cookie: (name, value) => {
          headers.append('Set-Cookie', `${name}=${value}`)
        },
        extensions: (ext) => {
          extensions = ext
        },
        field: (fieldName, value) => {
          extraFields[fieldName] = value
        },
        data: (dataValue) => {
          explicitData = dataValue
        },
        fetch: (input, init) => fetch(bypass(input, init)),
      }

      const req: MockGraphQLRequest = {
        request,
        query,
        operationName,
        variables,
        cookies,
        url: new URL(request.url),
        headers: request.headers,
        method: request.method,
      }

      // Awaited so `async` mock-data callbacks resolve before serialization.
      // Without this an unresolved promise reaches `HttpResponse.json()` and
      // serializes to `{}`, silently handing the caller empty `data`
      d = await data(variables, { req, ctx })
    } else {
      d = data
    }

    if (responseEnhancer === 'networkError') {
      return HttpResponse.error()
    }

    if (typeof delayDurationMs !== 'undefined') {
      await delay(delayDurationMs)
    }

    // Mirror MSW v1's transformer order: an explicit `ctx.data()` call
    // overrides the mock-data function's return value
    const body: Record<string, unknown> = { ...extraFields }
    const bodyData = explicitData ?? d
    if (typeof bodyData !== 'undefined') {
      body.data = bodyData
    }
    if (typeof errorList !== 'undefined') {
      body.errors = errorList
    }
    if (typeof extensions !== 'undefined') {
      body.extensions = extensions
    }

    return HttpResponse.json(body, { status, statusText, headers })
  }

  registerHandler(
    graphql[type](operation, resolver, {
      once: responseEnhancer === 'once',
    }),
  )
  return data
}

export const mockGraphQLQuery = <
  Query extends Record<string, unknown> = Record<string, unknown>,
  QueryVariables = Record<string, any>,
>(
  operation: string,
  data: DataFunction<Query, QueryVariables> | Query,
  responseEnhancer?: ResponseEnhancer,
) => {
  return mockGraphQL('query', operation, data, responseEnhancer)
}

export const mockGraphQLMutation = <
  Query extends Record<string, unknown> = Record<string, unknown>,
  QueryVariables = Record<string, any>,
>(
  operation: string,
  data: DataFunction<Query, QueryVariables> | Query,
  responseEnhancer?: ResponseEnhancer,
) => {
  return mockGraphQL('mutation', operation, data, responseEnhancer)
}

export const mockedUserMeta: { currentUser: Record<string, unknown> | null } = {
  currentUser: null,
}

export const mockCurrentUser = (user: Record<string, unknown> | null) => {
  mockedUserMeta.currentUser = user
  mockGraphQLQuery('__CEDAR__AUTH_GET_CURRENT_USER', () => {
    return {
      cedar: {
        currentUser: user,
      },
    }
  })
}
