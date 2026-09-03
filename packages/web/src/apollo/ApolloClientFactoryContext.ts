import React from 'react'

import type { ApolloClient } from '@apollo/client'

/**
 * Options accepted by the client factory that `useCreateApolloClient`
 * returns.
 */
export interface CreateApolloClientOptions {
  /**
   * Extra headers merged into every operation's headers, alongside the ones
   * `CedarApolloProvider`'s own link chain already sets (auth headers, the
   * headers from `useFetchConfig`, and so on).
   */
  headers?: Record<string, string>
}

/**
 * Builds a new `ApolloClient` that shares `CedarApolloProvider`'s link
 * chain, `defaultOptions` and client config, but gets its own fresh cache
 * and, when given, extra headers on every operation.
 */
export type CreateApolloClient = (
  options?: CreateApolloClientOptions,
) => ApolloClient

/**
 * Set by `ApolloProviderWithFetchConfig` so that `useCreateApolloClient` can
 * build additional Apollo clients from the same configuration.
 */
export const ApolloClientFactoryContext = React.createContext<
  CreateApolloClient | undefined
>(undefined)
