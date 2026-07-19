import type {
  ApolloCache,
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCacheConfig,
} from '@apollo/client'

export type ApolloClientCacheConfig = InMemoryCacheConfig

export type CedarApolloLinkName =
  | 'withToken'
  | 'authMiddleware'
  | 'updateDataApolloLink'
  | 'httpLink'

export type CedarApolloLink<
  Name extends CedarApolloLinkName,
  Link extends ApolloLink = ApolloLink,
> = {
  name: Name
  link: Link
}

export type CedarApolloLinks = [
  CedarApolloLink<'withToken'>,
  CedarApolloLink<'authMiddleware'>,
  CedarApolloLink<'updateDataApolloLink'>,
  CedarApolloLink<'httpLink', ApolloLink | HttpLink>,
]

export type CedarApolloLinkFactory = (links: CedarApolloLinks) => ApolloLink

export type GraphQLClientConfigProp = Omit<
  ApolloClient.Options,
  'cache' | 'link'
> & {
  cache?: ApolloCache
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
  link?: ApolloLink | CedarApolloLinkFactory
}
