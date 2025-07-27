import fastifyMultiPart from '@fastify/multipart'
import fastifyUrlData from '@fastify/url-data'
import fg from 'fast-glob'
import type {
  FastifyInstance,
  HTTPMethods,
  FastifyReply,
  FastifyRequest,
} from 'fastify'

import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { coerceRootPath } from '@cedarjs/fastify-web/dist/helpers'
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

  const method = ['GET', 'POST', 'OPTIONS'] as HTTPMethods[]

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
      const filePath = `file://${graphqlFunctionPath}`

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
    // These would be plugins that need a server instance such as Redwood Realtime
    if (graphqlOptions?.realtime) {
      const { useRedwoodRealtime } = await import('@cedarjs/realtime')

      const originalExtraPlugins = graphqlOptions.extraPlugins ?? []
      // @ts-expect-error TODO(jgmw): Fix this type issue introduced after switching to Node16 module resolution
      originalExtraPlugins.push(useRedwoodRealtime(graphqlOptions.realtime))
      graphqlOptions.extraPlugins = originalExtraPlugins

      // uses for SSE single connection mode with the `/graphql/stream` endpoint
      if (graphqlOptions.realtime.subscriptions) {
        method.push('PUT')
      }
    }

    const { yoga } = createGraphQLYoga(graphqlOptions)

    const graphQLYogaHandler = async (
      req: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const response = await yoga.handleNodeRequest(req, {
        req,
        reply,
        event: lambdaEventForFastifyRequest(req),
        requestContext: {},
      })

      for (const [name, value] of response.headers) {
        reply.header(name, value)
      }

      reply.status(response.status)
      reply.send(response.body)

      return reply
    }

    const graphqlEndpoint = trimSlashes(yoga.graphqlEndpoint)

    const routePaths = ['', '/health', '/readiness', '/stream']
    for (const routePath of routePaths) {
      fastify.route({
        url: `${redwoodOptions.apiRootPath}${graphqlEndpoint}${routePath}`,
        method,
        handler: (req, reply) => graphQLYogaHandler(req, reply),
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
