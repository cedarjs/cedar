import { pathToFileURL } from 'node:url'

import fastifyMultiPart from '@fastify/multipart'
import fastifyUrlData from '@fastify/url-data'
import fg from 'fast-glob'
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
} from 'fastify'

import { buildCedarContext } from '@cedarjs/api/runtime'
import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { coerceRootPath } from '@cedarjs/fastify-web/dist/helpers.js'
import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'
import { getPaths } from '@cedarjs/project-config'

import { lambdaEventForFastifyRequest } from '../requestHandlers/awsLambdaFastify.js'

export interface CedarFastifyGraphQLOptions {
  cedar: {
    apiRootPath?: string
    graphql?: GraphQLYogaOptions
    configureServer?: (server: FastifyInstance) => void | Promise<void>
  }
}

export async function cedarFastifyGraphQLServer(
  fastify: FastifyInstance,
  options: CedarFastifyGraphQLOptions,
) {
  const cedarOptions = options.cedar ?? {}
  cedarOptions.apiRootPath ??= '/'
  cedarOptions.apiRootPath = coerceRootPath(cedarOptions.apiRootPath)

  fastify.register(fastifyUrlData)
  // We register the multiPart plugin, but not the raw body plugin.
  // This is to allow multi-part form data to be parsed - otherwise you get errors
  fastify.register(fastifyMultiPart)

  const method: HTTPMethods[] = ['GET', 'POST', 'OPTIONS']

  fastify.addHook('onRequest', (_req, _reply, done) => {
    getAsyncStoreInstance().run(new Map<string, GlobalContext>(), done)
  })

  // Run the user's custom server configuration function, scoped to this
  // plugin's own encapsulation context (i.e. it applies to the GraphQL
  // routes only, not to the sibling api function routes). For config that
  // should apply to both, register it directly on the `server` instance
  // returned by `createServer()` instead.
  if (cedarOptions.configureServer) {
    await cedarOptions.configureServer(fastify)
  }

  try {
    // Load the graphql options from the user's graphql function if none are
    // explicitly provided
    if (!cedarOptions.graphql) {
      const [graphqlFunctionPath] = await fg('dist/functions/graphql.{ts,js}', {
        cwd: getPaths().api.base,
        absolute: true,
      })
      const filePath = pathToFileURL(graphqlFunctionPath).href

      // This comes from a babel plugin that's applied to
      // api/dist/functions/graphql.{ts,js} in user projects
      const { __cedar_graphqlOptions } = await import(filePath)

      if (!__cedar_graphqlOptions) {
        // Our babel plugin couldn't find any grapqhql config options, so we
        // assume the user is doing their own thing.
        // Return here and skip creating a Cedar specific server
        return
      }

      cedarOptions.graphql = __cedar_graphqlOptions as GraphQLYogaOptions
    }

    const graphqlOptions = cedarOptions.graphql

    // Used for SSE single connection mode with the `/graphql/stream` endpoint
    if (graphqlOptions?.realtime?.subscriptions) {
      method.push('PUT')
    }

    const { yoga } = await createGraphQLYoga(graphqlOptions)

    const graphqlEndpoint = trimSlashes(yoga.graphqlEndpoint)

    const routePaths = ['', '/health', '/readiness', '/stream']
    for (const routePath of routePaths) {
      fastify.route({
        url: `${cedarOptions.apiRootPath}${graphqlEndpoint}${routePath}`,
        method,
        handler: async (req, reply) => {
          const request = createFetchRequest(req, reply)
          const cedarContext = await buildCedarContext(request, {
            authDecoder: graphqlOptions.authDecoder,
          })

          // Phase 1 of transitional context bridge: pass both the Fetch-native
          // fields (request, cedarContext) and the legacy bridge fields
          // (event, requestContext) so that Cedar-owned Yoga plugins that
          // have not yet been migrated to the Fetch-native shape continue
          // to work. The bridge fields will be removed once all Cedar-owned
          // plugins prefer request/cedarContext over event/requestContext.
          // See: docs/implementation-plans/universal-deploy-integration-plan-refined.md
          // § "GraphQL Transitional Context Bridge"
          //
          // We return the Fetch-native Response directly. Fastify v5 has
          // first-class support for WHATWG Response objects: it reads the
          // status, copies headers, and for a ReadableStream body it calls
          // sendWebStream (via getReader()) which correctly keeps SSE /
          // @live query connections open for as long as the client is
          // connected. This is the fetch-native adapter pattern described in
          // the Universal Deploy integration plan.
          try {
            return await yoga.handle(request, {
              request,
              cedarContext,
              event: lambdaEventForFastifyRequest(req),
              requestContext: undefined,
            })
          } catch (e) {
            if (isClientDisconnectError(e)) {
              // Client disconnected while the request was being processed
              // (e.g., page navigation, tab close). Return a 499 so Fastify
              // doesn't log this as a 500.
              return new Response(null, { status: 499 })
            }

            throw e
          }
        },
      })
    }

    fastify.addHook('onReady', (done) => {
      console.info(`GraphQL Yoga Server endpoint at ${graphqlEndpoint}`)
      console.info(
        `GraphQL Yoga Server Health Check endpoint at ${graphqlEndpoint}/health`,
      )
      console.info(
        `GraphQL Yoga Server Readiness endpoint at ${graphqlEndpoint}/readiness`,
      )

      done()
    })
  } catch (e) {
    // Rethrow rather than swallow. Anything thrown in here means no GraphQL
    // routes got registered, so the server would come up healthy while 404ing
    // /graphql and everything under it. Failing to start with the actual cause
    // is far easier to diagnose than a silently empty route table.
    const message = e instanceof Error ? e.message : String(e)

    fastify.log.error(e, `Failed to set up the GraphQL server: ${message}`)

    throw e
  }
}

function trimSlashes(path: string) {
  return path.replace(/^\/|\/$/g, '')
}

/**
 * Detects errors that indicate the client disconnected before the response
 * finished, rather than a genuine server-side failure.
 *
 * `ERR_STREAM_PREMATURE_CLOSE` can surface from the underlying Node stream
 * closing early. The `DOMException` named `AbortError` is thrown by Yoga
 * when the AbortSignal wired up in `createFetchRequest`'s
 * `reply.raw.on('close', ...)` handler is aborted, which only happens when
 * the client itself has gone away.
 *
 * The `DOMException` check (rather than just `name === 'AbortError'`) is
 * deliberate: a resolver or hook could throw a plain `Error` renamed to
 * `AbortError`, which would otherwise be misclassified as a benign
 * disconnect and hide a real server-side failure behind a 499.
 */
export function isClientDisconnectError(e: unknown): boolean {
  if (!e || typeof e !== 'object') {
    return false
  }

  if ('code' in e && e.code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return true
  }

  if (e instanceof DOMException && e.name === 'AbortError') {
    return true
  }

  return false
}

function createFetchRequest(req: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController()

  // Abort the signal when the response stream closes before the response was
  // fully written, i.e. when the client disconnected (navigated away, tab
  // closed, etc.). This lets Yoga's useExecutionCancellation stop resolver
  // execution instead of continuing to waste work on a response nobody will
  // receive.
  //
  // We listen on reply.raw (the Node.js ServerResponse) rather than req.raw
  // (the IncomingMessage) because req.raw's 'close' event fires on every normal
  // end-of-stream, causing every request to be spuriously aborted. reply.raw
  // only closes before writableFinished when the client genuinely disconnects
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) {
      controller.abort()
    }
  })

  const requestBody =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : typeof req.body === 'string'
        ? req.body
        : req.body
          ? JSON.stringify(req.body)
          : undefined

  const href = `${req.protocol}://${req.hostname}${req.raw.url ?? '/'}`
  return new Request(href, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: requestBody,
    signal: controller.signal,
  })
}
