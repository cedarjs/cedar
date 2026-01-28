import type { Plugin } from 'graphql-yoga'

import type { AuthContextPayload, Decoder } from '@cedarjs/api'
import { getAuthenticationContext } from '@cedarjs/api'

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
      let authContext: AuthContextPayload | undefined = undefined

      try {
        authContext = await getAuthenticationContext({
          authDecoder,
          event: context.event,
          context: context.requestContext,
        })
      } catch (error: any) {
        throw new Error(
          `Exception in getAuthenticationContext: ${error.message}`,
        )
      }

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
