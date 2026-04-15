import { Readable } from 'node:stream'
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
import type { Plugin as YogaPlugin } from 'graphql-yoga'

import { buildCedarContext } from '@cedarjs/api/runtime'
import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { coerceRootPath } from '@cedarjs/fastify-web/dist/helpers.js'
import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'
import { getPaths } from '@cedarjs/project-config'

import { lambdaEventForFastifyRequest } from '../requestHandlers/awsLambdaFastify.js'

export interface RedwoodFastifyGraphQLOptions {
  redwood: {
    apiRootPath?: string
    graphql?: GraphQLYogaOptions
  }
}

export async function redwoodFastifyGraphQLServer(
  fastify: FastifyInstance,
  options: RedwoodFastifyGraphQLOptions,
) {
  const redwoodOptions = options.redwood ?? {}
  redwoodOptions.apiRootPath ??= '/'
  redwoodOptions.apiRootPath = coerceRootPath(redwoodOptions.apiRootPath)

  fastify.register(fastifyUrlData)
  // We register the multiPart plugin, but not the raw body plugin.
  // This is to allow multi-part form data to be parsed - otherwise you get errors
  fastify.register(fastifyMultiPart)

  const method: HTTPMethods[] = ['GET', 'POST', 'OPTIONS']

  fastify.addHook('onRequest', (_req, _reply, done) => {
    getAsyncStoreInstance().run(new Map<string, GlobalContext>(), done)
  })

  try {
    // Load the graphql options from the user's graphql function if none are
    // explicitly provided
    if (!redwoodOptions.graphql) {
      const [graphqlFunctionPath] = await fg('dist/functions/graphql.{ts,js}', {
        cwd: getPaths().api.base,
        absolute: true,
      })
      const filePath = pathToFileURL(graphqlFunctionPath).href

      // This comes from a babel plugin that's applied to
      // api/dist/functions/graphql.{ts,js} in user projects
      const { __rw_graphqlOptions } = await import(filePath)

      if (!__rw_graphqlOptions) {
        // Our babel plugin couldn't find any grapqhql config options, so we
        // assume the user is doing their own thing.
        // Return here and skip creating a Cedar specific server
        return
      }

      redwoodOptions.graphql = __rw_graphqlOptions as GraphQLYogaOptions
    }

    const graphqlOptions = redwoodOptions.graphql

    // Here we can add any plugins that we want to use with GraphQL Yoga Server
    // that we do not want to add the the GraphQLHandler in the graphql-server
    // graphql function.
    //
    // These would be plugins that need a server instance such as Cedar Realtime
    if (graphqlOptions?.realtime) {
      const { useCedarRealtime } = await import('@cedarjs/realtime')

      const originalExtraPlugins = graphqlOptions.extraPlugins ?? []
      originalExtraPlugins.push(
        // This type cast is needed because useCedarRealtime returns an
        // EnvelopPlugin and here we need a YogaPlugin. I can't change the
        // return type of `useCedarRealtime` yet, because it'd be a breaking
        // change.
        useCedarRealtime(graphqlOptions.realtime) as YogaPlugin,
      )
      graphqlOptions.extraPlugins = originalExtraPlugins

      // uses for SSE single connection mode with the `/graphql/stream` endpoint
      if (graphqlOptions.realtime.subscriptions) {
        method.push('PUT')
      }
    }

    const { yoga } = createGraphQLYoga(graphqlOptions)

    const graphqlEndpoint = trimSlashes(yoga.graphqlEndpoint)

    const routePaths = ['', '/health', '/readiness', '/stream']
    for (const routePath of routePaths) {
      fastify.route({
        url: `${redwoodOptions.apiRootPath}${graphqlEndpoint}${routePath}`,
        method,
        handler: async (req, reply) => {
          const request = createFetchRequest(req)
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
          const response = await yoga.handle(request, {
            request,
            cedarContext,
            event: lambdaEventForFastifyRequest(req),
            requestContext: undefined,
          })

          await sendGraphQLResponse(reply, response)
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
    console.log(e)
  }
}

function trimSlashes(path: string) {
  return path.replace(/^\/|\/$/g, '')
}

function createFetchRequest(req: FastifyRequest) {
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
  })
}

async function sendGraphQLResponse(reply: FastifyReply, response: Response) {
  reply.status(response.status)

  response.headers.forEach((value: string, name: string) => {
    reply.header(name, value)
  })

  if (shouldStreamGraphQLResponse(response)) {
    // Stream the response body rather than buffering it. This is critical for
    // SSE / @live query connections, which use text/event-stream and keep the
    // response open indefinitely.
    // Calling arrayBuffer() on such a stream would hang forever and the client
    // would never receive any events.
    //
    // This adapter (api-server) is Node/Fastify-specific.
    // On other runtimes (Cloudflare Workers, Bun, Deno) the fetch Response is
    // returned directly by the runtime handler and streaming is handled
    // natively so no conversion needed there.
    //
    // Readable.from() is used instead of Readable.fromWeb() because GraphQL
    // Yoga returns a PonyfillReadableStream from @whatwg-node/fetch.
    // Readable.fromWeb() requires a native Node.js built-in ReadableStream and
    // uses instanceof under the hood, so it rejects the ponyfill with
    // ERR_INVALID_ARG_TYPE. Readable.from() accepts any AsyncIterable, and
    // PonyfillReadableStream implements [Symbol.asyncIterator], so it works for
    // both native and ponyfilled streams.
    reply.send(response.body ? Readable.from(response.body) : '')

    return
  }

  const body = await response.arrayBuffer()
  reply.send(Buffer.from(body))
}

function shouldStreamGraphQLResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    return true
  }

  if (contentType.includes('multipart/mixed')) {
    return true
  }

  return false
}
