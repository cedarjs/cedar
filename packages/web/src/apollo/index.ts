import type { ApolloLink } from '@apollo/client'

import { CedarApolloProvider } from './CedarApolloProvider.js'
import type {
  ApolloClientCacheConfig as CedarApolloClientCacheConfig,
  CedarApolloLink,
  CedarApolloLinkFactory,
  CedarApolloLinkName,
  CedarApolloLinks,
  GraphQLClientConfigProp as CedarGraphQLClientConfigProp,
} from './CedarApolloProvider.js'
import {
  fragmentRegistry,
  registerFragment,
  registerFragments,
} from './fragmentRegistry.js'
import { useCache } from './useCache.js'

export type {
  CacheKey,
  FragmentIdentifier,
  RegisterFragmentResult,
} from './fragmentRegistry.js'

export { useCache }

export { fragmentRegistry, registerFragment, registerFragments }

/**
 * @deprecated Import from `@cedarjs/web/apollo/CedarApolloProvider` instead.
 * This re-export will be removed in a future release.
 *
 * ```js
 * import type { ApolloClientCacheConfig } from '@cedarjs/web/apollo/CedarApolloProvider'
 * ```
 */
export type ApolloClientCacheConfig = CedarApolloClientCacheConfig

/**
 * @deprecated Import from `@cedarjs/web/apollo/CedarApolloProvider` instead.
 * This re-export will be removed in a future release.
 *
 * ```js
 * import type { GraphQLClientConfigProp } from '@cedarjs/web/apollo/CedarApolloProvider'
 * ```
 */
export type GraphQLClientConfigProp = CedarGraphQLClientConfigProp

/**
 * @deprecated Use `CedarApolloLinkName` instead. `RedwoodApolloLinkName` will
 * be removed in a future release.
 */
export type RedwoodApolloLinkName = CedarApolloLinkName

/**
 * @deprecated Use `CedarApolloLink` instead. `RedwoodApolloLink` will be
 * removed in a future release.
 */
export type RedwoodApolloLink<
  Name extends CedarApolloLinkName,
  Link extends ApolloLink = ApolloLink,
> = CedarApolloLink<Name, Link>

/**
 * @deprecated Use `CedarApolloLinks` instead. `RedwoodApolloLinks` will be
 * removed in a future release.
 */
export type RedwoodApolloLinks = CedarApolloLinks

/**
 * @deprecated Use `CedarApolloLinkFactory` instead. `RedwoodApolloLinkFactory`
 * will be removed in a future release.
 */
export type RedwoodApolloLinkFactory = CedarApolloLinkFactory

/**
 * @deprecated Use `CedarApolloProvider` instead. `RedwoodApolloProvider` will
 * be removed in a future release.
 *
 * ```js
 * import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'
 * ```
 */
export const RedwoodApolloProvider = CedarApolloProvider
