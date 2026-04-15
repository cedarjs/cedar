import type { APIGatewayProxyEvent } from 'aws-lambda'
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
      let authContext: AuthContextPayload | undefined =
        context.cedarContext?.serverAuthState

      try {
        if (!authContext) {
          const authEvent = getAuthEvent(context)

          authContext = await getAuthenticationContext({
            authDecoder,
            event: authEvent,
            context: context.requestContext,
          })
        }
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

function getAuthEvent(
  context: CedarGraphQLContext,
): APIGatewayProxyEvent | Request {
  if (context.request) {
    return context.request
  }

  if (context.event) {
    return context.event
  }

  // This should never happen in practice. Either a fetch-native Request
  // or a Lambda event is always present in the GraphQL context.
  throw new Error(
    'GraphQL context contains neither a fetch-native Request nor a Lambda ' +
      'event. Please report this as a Cedar bug.',
  )
}
