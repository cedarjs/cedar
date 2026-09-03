import React from 'react'

import type { CreateApolloClient } from './ApolloClientFactoryContext.js'
import { ApolloClientFactoryContext } from './ApolloClientFactoryContext.js'

/**
 * Returns a factory that builds a new `ApolloClient` sharing
 * `CedarApolloProvider`'s link chain, auth headers and `defaultOptions`, but
 * with its own fresh `InMemoryCache` and, when given, extra headers merged
 * into every operation.
 *
 * Must be called from a component rendered under `CedarApolloProvider`.
 */
export function useCreateApolloClient(): CreateApolloClient {
  const createClient = React.useContext(ApolloClientFactoryContext)

  if (!createClient) {
    throw new Error(
      'useCreateApolloClient must be used within a CedarApolloProvider',
    )
  }

  return createClient
}
