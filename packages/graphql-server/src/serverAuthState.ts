import type { APIGatewayProxyEvent, Context as LambdaContext } from 'aws-lambda'

import { getAuthenticationContext } from '@cedarjs/api'
import type { AuthContextPayload } from '@cedarjs/api'

import type { GraphQLYogaOptions } from './types.js'

export type ServerAuthOptions = Pick<
  GraphQLYogaOptions,
  'authDecoder' | 'getCurrentUser'
>

/**
 * Resolves the auth state a GraphQL request carries: the token and provider
 * type from its `Authorization`/`auth-provider` headers or cookies, plus what
 * the configured decoders make of the token. `getCurrentUser` turns that into
 * the current user.
 *
 * `getCurrentUser` is the only consumer, so when a server has none there is
 * nothing to resolve for. That also spares a server without auth from failing
 * a request that carries a stray `auth-provider` header but no usable
 * `Authorization` header.
 *
 * Decoders are optional. A project whose tokens can't be decoded locally, such
 * as opaque OAuth access tokens, has `getCurrentUser` validate the raw token
 * it's handed instead, and the decoded value it receives is `null`.
 *
 * On fetch-native paths this has to run before the GraphQL server reads the
 * request body: the payload carries a Lambda-style event built from the
 * `Request`, and building it reads the body.
 */
export async function resolveServerAuthState(
  { authDecoder, getCurrentUser }: ServerAuthOptions,
  event: APIGatewayProxyEvent | Request,
  context?: LambdaContext,
): Promise<AuthContextPayload | undefined> {
  if (!getCurrentUser) {
    return undefined
  }

  return getAuthenticationContext({ authDecoder, event, context })
}
