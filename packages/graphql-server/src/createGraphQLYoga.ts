import { useDisableIntrospection } from '@envelop/disable-introspection'
import { useFilterAllowedOperations } from '@envelop/filter-operation-type'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { OperationTypeNode } from 'graphql'
import type { GraphQLSchema } from 'graphql'
import {
  useReadinessCheck,
  createYoga,
  useExecutionCancellation,
} from 'graphql-yoga'
import type { Plugin, YogaServerInstance } from 'graphql-yoga'

import type { Logger } from '@cedarjs/api/logger'
import { buildCedarContext } from '@cedarjs/api/runtime'
import type { CedarRequestContext } from '@cedarjs/api/runtime'

import { mapRwCorsOptionsToYoga } from './cors.js'
import { makeDirectivesForPlugin } from './directives/makeDirectives.js'
import { configureGraphiQLPlayground } from './graphiql.js'
import { configureGraphQLIntrospection } from './introspection.js'
import { makeMergedSchema } from './makeMergedSchema.js'
import {
  useArmor,
  useCedarAuthContext,
  useCedarDirective,
  useCedarError,
  useCedarGlobalContextSetter,
  useCedarOpenTelemetry,
  useCedarLogger,
  useCedarPopulateContext,
  useCedarTrustedDocuments,
} from './plugins/index.js'
import type {
  UseCedarDirectiveReturn,
  DirectivePluginOptions,
} from './plugins/useRedwoodDirective.js'
import { resolveServerAuthState } from './serverAuthState.js'
import { makeSubscriptions } from './subscriptions/makeSubscriptions.js'
import type { CedarSubscription } from './subscriptions/makeSubscriptions.js'
import type { GraphQLYogaOptions, CedarGraphQLContext } from './types.js'

/**
 * The server context Yoga is created with. The Fastify entry point adds the
 * request and reply it's handling; every entry point adds `cedarContext`.
 */
type CedarYogaServerContext = {
  req: FastifyRequest
  reply: FastifyReply
} & CedarGraphQLContext

/**
 * A configured Cedar GraphQL server: the Yoga instance, the logger it logs
 * with, and the builder for the request context `yoga.handle` needs to be
 * given. They belong together: the context the builder produces carries the
 * auth state that this instance's plugins read.
 */
export interface CedarGraphQLServer {
  yoga: YogaServerInstance<CedarYogaServerContext, Record<string, never>>
  logger: Logger
  /**
   * Builds the `cedarContext` to hand `yoga.handle` for a request, with the
   * auth state this server's `getCurrentUser` needs already resolved. Call
   * it before `yoga.handle`, which reads the request body.
   */
  buildRequestContext: (request: Request) => Promise<CedarRequestContext>
}

export const createGraphQLYoga = async ({
  healthCheckId = 'yoga',
  loggerConfig,
  context,
  getCurrentUser,
  onException,
  generateGraphiQLHeader,
  extraPlugins,
  authDecoder,
  cors,
  services,
  sdls,
  directives = [],
  armorConfig,
  allowedOperations,
  allowIntrospection,
  allowGraphiQL,
  defaultError = 'Something went wrong.',
  graphiQLEndpoint = '/graphql',
  schemaOptions,
  realtime,
  trustedDocuments,
  openTelemetryOptions,
  includeScalars,
}: GraphQLYogaOptions): Promise<CedarGraphQLServer> => {
  let schema: GraphQLSchema
  let cedarDirectivePlugins: Plugin[] = []
  const logger = loggerConfig.logger

  const isDevEnv = process.env.NODE_ENV === 'development'

  try {
    // @NOTE: Directives are optional
    const projectDirectives = makeDirectivesForPlugin(directives)

    if (projectDirectives.length > 0) {
      ;(cedarDirectivePlugins as UseCedarDirectiveReturn[]) =
        projectDirectives.map((directive) =>
          useCedarDirective(directive as DirectivePluginOptions),
        )
    }

    // @NOTE: Subscriptions are optional and only work in the context of a server
    let projectSubscriptions: CedarSubscription[] = []

    if (realtime?.subscriptions?.subscriptions) {
      projectSubscriptions = makeSubscriptions(
        realtime.subscriptions.subscriptions,
      )
    }

    schema = makeMergedSchema({
      sdls,
      services,
      directives: projectDirectives,
      subscriptions: projectSubscriptions,
      schemaOptions,
      includeScalars,
    })
  } catch (e) {
    logger.fatal(e as Error, '\n ⚠️ GraphQL server crashed \n')

    if (onException) {
      onException()
    }

    // Forcefully crash the graphql server
    // so users know that a misconfiguration has happened
    process.exit(1)
  }

  try {
    // Important: Plugins are executed in order of their usage, and inject functionality serially,
    // so the order here matters
    const plugins: Plugin<any>[] = []

    if (realtime) {
      // Add Cedar Realtime plugin for live queries and subscriptions support
      // This registers the @live directive on the schema and handles live query
      // execution
      const { useCedarRealtime } = await import('@cedarjs/realtime')
      plugins.push(useCedarRealtime(realtime))
    }

    // Abort resolver execution when the client disconnects (e.g., page
    // navigation, tab close). Without this, resolvers continue running
    // unnecessarily and the response stream write may fail with
    // ERR_STREAM_PREMATURE_CLOSE, producing a logged 500 even though the client
    // is already gone.
    plugins.push(useExecutionCancellation())

    const { disableIntrospection } = configureGraphQLIntrospection({
      allowIntrospection,
    })

    if (disableIntrospection) {
      plugins.push(useDisableIntrospection())
    }

    // Custom Cedar plugins
    plugins.push(useCedarAuthContext(getCurrentUser))
    plugins.push(useCedarGlobalContextSetter())

    if (context) {
      plugins.push(useCedarPopulateContext(context))
    }

    // Custom Cedar plugins
    plugins.push(...cedarDirectivePlugins)

    // Custom Cedar OpenTelemetry plugin
    if (openTelemetryOptions !== undefined) {
      plugins.push(useCedarOpenTelemetry(openTelemetryOptions))
    }

    // Secure the GraphQL server
    plugins.push(useArmor(logger, armorConfig))

    // Only allow execution of specific operation types
    const defaultAllowedOperations = [
      OperationTypeNode.QUERY,
      OperationTypeNode.MUTATION,
    ]

    // allow subscriptions if using them (unless you override)
    if (realtime?.subscriptions?.subscriptions) {
      defaultAllowedOperations.push(OperationTypeNode.SUBSCRIPTION)
    }

    plugins.push(
      useFilterAllowedOperations(allowedOperations || defaultAllowedOperations),
    )

    if (trustedDocuments && !trustedDocuments.disabled) {
      plugins.push(useCedarTrustedDocuments(trustedDocuments))
    }

    // App-defined plugins
    if (extraPlugins && extraPlugins.length > 0) {
      plugins.push(...extraPlugins)
    }

    plugins.push(useCedarError(logger))

    plugins.push(
      useReadinessCheck({
        endpoint: graphiQLEndpoint + '/readiness',
        check: async ({ request }) => {
          try {
            // if we can reach the health check endpoint ...
            const response = await yoga.fetch(
              new URL(graphiQLEndpoint + '/health', request.url),
            )

            // ... and the health check id match the request's and response's
            const status =
              response.headers.get('x-yoga-id') === healthCheckId &&
              request.headers.get('x-yoga-id') === healthCheckId

            // then we're good to go (or not)
            return status
          } catch (err) {
            logger.error(err)
            return false
          }
        },
      }),
    )

    // Must be "last" in plugin chain, but before error masking
    // so can process any data added to results and extensions
    plugins.push(useCedarLogger(loggerConfig))

    const yoga = createYoga<CedarYogaServerContext>({
      id: healthCheckId,
      landingPage: isDevEnv,
      schema,
      plugins,
      maskedErrors: {
        errorMessage: defaultError,
        isDev: isDevEnv,
      },
      logging: logger,
      healthCheckEndpoint: graphiQLEndpoint + '/health',
      graphqlEndpoint: graphiQLEndpoint,
      graphiql: configureGraphiQLPlayground({
        allowGraphiQL,
        generateGraphiQLHeader,
      }),
      cors: (request: Request) => {
        const requestOrigin = request.headers.get('origin')
        return mapRwCorsOptionsToYoga(cors, requestOrigin)
      },
    })

    const buildRequestContext = async (
      request: Request,
    ): Promise<CedarRequestContext> => {
      const cedarContext = await buildCedarContext(request)

      return {
        ...cedarContext,
        serverAuthState: await resolveServerAuthState(
          { authDecoder, getCurrentUser },
          request,
        ),
      }
    }

    return { yoga, logger, buildRequestContext }
  } catch (e) {
    if (onException) {
      onException()
    }
    throw e
  }
}
