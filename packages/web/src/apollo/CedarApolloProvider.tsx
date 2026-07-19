import React from 'react'

import type { DocumentNode, setLogVerbosity } from '@apollo/client'
import { InMemoryCache } from '@apollo/client/cache/cache.cjs'

import type { UseAuth } from '@cedarjs/auth'
import { useNoAuth } from '@cedarjs/auth'

import { FetchConfigProvider } from '../components/FetchConfigProvider.js'

import type { GraphQLClientConfigProp } from './apolloLinkTypes.js'
import { ApolloProviderWithFetchConfig } from './ApolloProviderWithFetchConfig.js'
import { fragmentRegistry } from './fragmentRegistry.js'

export type {
  ApolloClientCacheConfig,
  CedarApolloLink,
  CedarApolloLinkFactory,
  CedarApolloLinkName,
  CedarApolloLinks,
  GraphQLClientConfigProp,
} from './apolloLinkTypes.js'

interface Props {
  graphQLClientConfig?: GraphQLClientConfigProp
  fragments?: DocumentNode[]
  useAuth?: UseAuth
  logLevel?: ReturnType<typeof setLogVerbosity>
  children: React.ReactNode
}

export function CedarApolloProvider({
  graphQLClientConfig,
  fragments,
  useAuth = useNoAuth,
  logLevel = 'debug',
  children,
}: Props) {
  // Since Apollo Client gets re-instantiated on auth changes,
  // we have to instantiate `InMemoryCache` here, so that it doesn't get wiped.
  const { cacheConfig, ...config } = graphQLClientConfig ?? {}

  // Auto register fragments
  if (fragments) {
    fragmentRegistry.register(...fragments)
  }

  const cache = new InMemoryCache({
    fragments: fragmentRegistry,
    possibleTypes: cacheConfig?.possibleTypes,
    ...cacheConfig,
  }).restore(globalThis?.__REDWOOD__APOLLO_STATE ?? {})

  return (
    <FetchConfigProvider useAuth={useAuth}>
      <ApolloProviderWithFetchConfig
        // This order so that the user can still completely overwrite the cache.
        config={{ cache, ...config }}
        useAuth={useAuth}
        logLevel={logLevel}
      >
        {children}
      </ApolloProviderWithFetchConfig>
    </FetchConfigProvider>
  )
}
