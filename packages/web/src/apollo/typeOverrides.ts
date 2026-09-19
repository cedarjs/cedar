import type { InMemoryCache } from '@apollo/client'

// `CedarApolloProvider` always builds the client's cache with `InMemoryCache`
// (see `createCache` in CedarApolloProvider.tsx and suspense.tsx). Telling
// Apollo Client about that here makes `client.cache`, `useApolloClient().cache`,
// `useCache().cache` and the `cache` argument of mutation `update` callbacks
// resolve to `InMemoryCache` instead of the abstract `ApolloCache`, so app code
// can call `InMemoryCache`-only methods (like `extract()` returning a
// `NormalizedCacheObject`) without casting.
//
// This is a module augmentation, so it applies to every project that includes
// `@cedarjs/web`'s type declarations. It is imported for its side effect from
// the package's entry points.
declare module '@apollo/client' {
  interface TypeOverrides {
    cache: InMemoryCache
  }
}

export {}
