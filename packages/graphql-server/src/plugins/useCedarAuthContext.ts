import type { Plugin } from 'graphql-yoga'

import type { AuthContextPayload } from '@cedarjs/api'

import type { CedarGraphQLContext, GraphQLHandlerOptions } from '../types.js'

/**
 * Envelop plugin for injecting the current user into the GraphQL Context,
 * based on custom getCurrentUser function.
 */
export const useCedarAuthContext = (
  getCurrentUser: GraphQLHandlerOptions['getCurrentUser'],
): Plugin<CedarGraphQLContext> => {
  return {
    async onContextBuilding({ context, extendContext }) {
      // Auth state is resolved when the request enters Cedar, while the
      // request body is still readable. Resolving it here instead would mean
      // building a Lambda-style event from a `Request` the GraphQL server has
      // already consumed, which throws.
      //
      // Every Cedar entry point builds a context. One that doesn't would serve
      // every request as unauthenticated, with nothing to show for it, so say
      // so instead. `getCurrentUser` is the only thing that reads the auth
      // state, so a server without one is left alone.
      if (!context.cedarContext && getCurrentUser) {
        throw new Error(
          'Auth state is resolved when a request enters Cedar and passed on ' +
            'the GraphQL context, but this context has no `cedarContext`. ' +
            'Whatever is invoking `yoga.handle` needs to build one with the ' +
            '`buildRequestContext` returned by `createGraphQLYoga` and pass ' +
            'it as `cedarContext`.',
        )
      }

      const authContext: AuthContextPayload | undefined =
        context.cedarContext?.serverAuthState

      try {
        if (authContext) {
          const currentUser = getCurrentUser
            ? await getCurrentUser(
                authContext[0],
                authContext[1],
                authContext[2],
              )
            : null

          if (currentUser) {
            extendContext({ currentUser })
          }
        }
      } catch (error: any) {
        throw new Error(`Exception in getCurrentUser: ${error.message}`)
      }
    },
  }
}
