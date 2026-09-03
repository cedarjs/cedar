// Comment below written by Danny, originally here:
// https://github.com/redwoodjs/graphql/pull/9038
// and then further updated here:
// https://github.com/redwoodjs/graphql/pull/9074
// This is a lift and shift of the original ApolloProvider
// but with suspense specific bits. Look for @MARK to find bits I've changed
//
// Done this way, to avoid making changes breaking on main, due to the
// experimental-nextjs import
// Eventually we will have one ApolloProvider, not multiple.

'use client'
import React, { useContext } from 'react'

import type {
  ApolloClient as ApolloClientBase,
  HttpLink,
  InMemoryCacheConfig,
  setLogVerbosity,
} from '@apollo/client'
import {
  ApolloLink,
  setLogVerbosity as apolloSetLogVerbosity,
} from '@apollo/client'
import { SetContextLink } from '@apollo/client/link/context'
import {
  ApolloClient,
  InMemoryCache,
  WrapApolloProvider,
} from '@apollo/client-react-streaming'
import { buildManualDataTransport } from '@apollo/client-react-streaming/manual-transport'

import type { UseAuth } from '@cedarjs/auth'
import { useNoAuth } from '@cedarjs/auth'
import { ServerAuthContext } from '@cedarjs/auth/dist/AuthProvider/ServerAuthProvider.js'

import {
  FetchConfigProvider,
  useFetchConfig,
} from '../components/FetchConfigProvider.js'
import { ServerHtmlContext } from '../components/ServerInject.js'

import type { CreateApolloClientOptions } from './ApolloClientFactoryContext.js'
import { ApolloClientFactoryContext } from './ApolloClientFactoryContext.js'
import { fragmentRegistry } from './fragmentRegistry.js'
import type {
  RedwoodApolloLink,
  RedwoodApolloLinkFactory,
  RedwoodApolloLinkName,
  RedwoodApolloLinks,
} from './links.js'
import {
  createAuthApolloLink,
  createFinalLink,
  createHttpLink,
  createTokenLink,
  createUpdateDataLink,
} from './links.js'

export type ApolloClientCacheConfig = InMemoryCacheConfig

export type {
  RedwoodApolloLink,
  RedwoodApolloLinkFactory,
  RedwoodApolloLinkName,
  RedwoodApolloLinks,
}

export type GraphQLClientConfigProp = Omit<
  ApolloClientBase.Options,
  'cache' | 'link'
> & {
  cache?: InMemoryCache
  /**
   * Configuration for Apollo Client's `InMemoryCache`.
   * See https://www.apollographql.com/docs/react/caching/cache-configuration/.
   */
  cacheConfig?: ApolloClientCacheConfig
  /**
   * Configuration for the terminating `HttpLink`.
   * See https://www.apollographql.com/docs/react/api/link/apollo-link-http/#httplink-constructor-options.
   *
   * For example, you can use this prop to set the credentials policy so that cookies can be sent to other domains:
   *
   * ```js
   * <CedarApolloProvider graphQLClientConfig={{
   *   httpLinkConfig: { credentials: 'include' }
   * }}>
   * ```
   */
  httpLinkConfig?: HttpLink.Options
  /**
   * Extend or overwrite `CedarApolloProvider`'s Apollo Link.
   *
   * To overwrite Cedar's Apollo Link, just provide your own `ApolloLink`.
   *
   * To extend Cedar's Apollo Link, provide a function—it'll get passed an array of Cedar's Apollo Links
   * which are objects with a name and link property:
   *
   * ```js
   * const link = (cedarApolloLinks) => {
   *   const consoleLink = new ApolloLink((operation, forward) => {
   *     console.log(operation.operationName)
   *     return forward(operation)
   *   })
   *
   *   return ApolloLink.from([consoleLink, ...cedarApolloLinks.map(({ link }) => link)])
   * }
   * ```
   *
   * If you do this, there's a few things you should keep in mind:
   * - your function should return a single link (e.g., using `ApolloLink.from`; see https://www.apollographql.com/docs/react/api/link/introduction/#additive-composition)
   * - the `HttpLink` should come last (https://www.apollographql.com/docs/react/api/link/introduction/#the-terminating-link)
   */
  link?: ApolloLink | RedwoodApolloLinkFactory
}

// Based on the code from here:
// https://github.com/apollographql/apollo-client-nextjs/blob/0aca8251409de7b729f7caa9c14492b0044e0d21/integration-test/vite-streaming/src/Transport.tsx#L19
const WrappedApolloProvider = WrapApolloProvider(
  buildManualDataTransport({
    useInsertHtml() {
      return React.useContext(ServerHtmlContext)
    },
  }),
)

const ApolloProviderWithFetchConfig: React.FunctionComponent<{
  config: Omit<GraphQLClientConfigProp, 'cacheConfig' | 'cache'> & {
    cache: InMemoryCache
  }
  /**
   * Builds a fresh cache from the same cache configuration and fragment
   * registry as `config.cache`. Used to give every client
   * `useCreateApolloClient` creates its own cache.
   */
  createCache: () => InMemoryCache
  useAuth?: UseAuth
  logLevel: ReturnType<typeof setLogVerbosity>
  children: React.ReactNode
}> = ({ config, createCache, children, logLevel, useAuth = useNoAuth }) => {
  // Should they run into it, this helps users with the "Cannot render cell; GraphQL success but data is null" error.
  // See https://github.com/redwoodjs/redwood/issues/2473.
  apolloSetLogVerbosity(logLevel)

  const { uri, headers } = useFetchConfig()
  const { getToken, type: authProviderType } = useAuth()
  const isDev = process.env.NODE_ENV === 'development'

  const serverAuthState = useContext(ServerAuthContext)

  const getGraphqlUrl = () => {
    // @NOTE: This comes from packages/vite/src/streaming/registerGlobals.ts
    // this needs to be an absolute url, as relative urls cannot be used in SSR
    // @TODO (STREAMING): Should this be a new config value in Redwood.toml?
    // How do we know what the absolute url is in production?
    // Possible solution: https://www.apollographql.com/docs/react/api/link/apollo-link-schema/

    return typeof window === 'undefined'
      ? RWJS_ENV.RWJS_EXP_SSR_GRAPHQL_ENDPOINT
      : uri
  }

  const { httpLinkConfig, link: userPassedLink, ...otherConfig } = config ?? {}

  // We use this object, because that's the shape of what we pass to the config.link factory
  const redwoodApolloLinks: RedwoodApolloLinks = [
    // @MARK REMOVE: We will not need these for cookie based auth ~~~~
    { name: 'withToken', link: createTokenLink(getToken) },
    {
      name: 'authMiddleware',
      link: createAuthApolloLink(authProviderType, headers),
    },
    // ~~~~ @END REMOVE ~~~~
    isDev && { name: 'enhanceErrorLink', link: createUpdateDataLink() },
    {
      name: 'httpLink',
      link: createHttpLink(
        getGraphqlUrl(),
        httpLinkConfig,
        serverAuthState?.cookieHeader,
      ),
    },
  ].filter((link): link is RedwoodApolloLinks[number] => !!link)

  function makeClient() {
    // @MARK use special Apollo client
    return new ApolloClient({
      link: createFinalLink({
        userConfiguredLink: userPassedLink,
        defaultLinks: redwoodApolloLinks,
      }),
      ...otherConfig,
    })
  }

  // Builds a client with the same link chain and client config as
  // `makeClient` above, but with a fresh cache and, when given, extra
  // headers on every operation. `authMiddleware` (via `createAuthApolloLink`)
  // spreads `headersFromFetchProvider` before its own headers, so the
  // headers this link sets survive the rest of the chain.
  const createApolloClient = (
    options?: CreateApolloClientOptions,
  ): ApolloClientBase => {
    const extraHeaders = options?.headers

    const withExtraHeaders = new SetContextLink((prevContext) => ({
      headers: { ...prevContext.headers, ...extraHeaders },
    }))

    return new ApolloClient({
      ...otherConfig,
      cache: createCache(),
      link: ApolloLink.from([
        withExtraHeaders,
        createFinalLink({
          userConfiguredLink: userPassedLink,
          defaultLinks: redwoodApolloLinks,
        }),
      ]),
    })
  }

  return (
    <ApolloClientFactoryContext.Provider value={createApolloClient}>
      <WrappedApolloProvider makeClient={makeClient}>
        {children}
      </WrappedApolloProvider>
    </ApolloClientFactoryContext.Provider>
  )
}

export const CedarApolloProvider: React.FunctionComponent<{
  graphQLClientConfig?: GraphQLClientConfigProp
  useAuth?: UseAuth
  logLevel?: ReturnType<typeof setLogVerbosity>
  children: React.ReactNode
}> = ({
  graphQLClientConfig,
  useAuth = useNoAuth,
  logLevel = 'debug',
  children,
}) => {
  // Since Apollo Client gets re-instantiated on auth changes,
  // we have to instantiate `InMemoryCache` here, so that it doesn't get wiped.
  const { cacheConfig, ...config } = graphQLClientConfig ?? {}

  // Shared by the app's own cache below and by every cache
  // `useCreateApolloClient` builds, so every client (the app client and any
  // per-organization client created from it) uses the same cache
  // configuration and fragment registry.
  //
  // @MARK we need this special cache
  const createCache = (): InMemoryCache => {
    return new InMemoryCache({
      fragments: fragmentRegistry,
      ...cacheConfig,
    })
  }

  const cache = createCache().restore(globalThis?.__CEDAR__APOLLO_STATE ?? {})

  return (
    <FetchConfigProvider useAuth={useAuth}>
      <ApolloProviderWithFetchConfig
        // This order so that the user can still completely overwrite the cache.
        config={{ cache, ...config }}
        createCache={createCache}
        useAuth={useAuth}
        logLevel={logLevel}
      >
        {children}
      </ApolloProviderWithFetchConfig>
    </FetchConfigProvider>
  )
}

/**
 * @deprecated Use `CedarApolloProvider` instead. `RedwoodApolloProvider` will
 * be removed in a future release.
 */
export const RedwoodApolloProvider = CedarApolloProvider
