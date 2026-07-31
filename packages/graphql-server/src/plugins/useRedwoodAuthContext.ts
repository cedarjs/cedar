import type { Plugin } from 'graphql-yoga'

import type { AuthContextPayload, Decoder } from '@cedarjs/api'
import { hasAuthDecoder } from '@cedarjs/api/runtime'

import type { CedarGraphQLContext, GraphQLHandlerOptions } from '../types.js'

/**
 * Envelop plugin for injecting the current user into the GraphQL Context,
 * based on custom getCurrentUser function.
 */
export const useRedwoodAuthContext = (
  getCurrentUser: GraphQLHandlerOptions['getCurrentUser'],
  authDecoder?: Decoder | Decoder[],
): Plugin<CedarGraphQLContext> => {
  return {
    async onContextBuilding({ context, extendContext }) {
      // Auth state is resolved when the request enters Cedar, while the
      // request body is still readable. Resolving it here instead would mean
      // building a Lambda-style event from a `Request` the GraphQL server has
      // already consumed, which throws.
      //
      // Every Cedar entry point builds a context. A missing one means a custom
      // GraphQL server that hasn't been updated — better to say so than to
      // silently serve every request as unauthenticated.
      if (!context.cedarContext && hasAuthDecoder(authDecoder)) {
        throw new Error(
          'The GraphQL context has no `cedarContext`, so auth state was ' +
            'never resolved. A custom GraphQL server has to build one with ' +
            '`buildCedarContext` from `@cedarjs/api/runtime` and pass it to ' +
            '`yoga.handle(request, { request, cedarContext })`.',
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
