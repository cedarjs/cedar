import * as apolloClient from '@apollo/client'
import type { UseFragmentResult } from '@apollo/client'
import { createFragmentRegistry } from '@apollo/client/cache/cache.cjs'
import type { FragmentRegistryAPI } from '@apollo/client/cache/index.js'
import { getFragmentDefinitions } from '@apollo/client/utilities/utilities.cjs'
import type { DocumentNode } from 'graphql'

export interface FragmentHookOptions {
  fragment: DocumentNode
  fragmentName?: string
  /**
   * The object to read the fragment data for. Usually a cache reference like
   * `{ __typename: 'User', id: 1 }`, but any object that Apollo Client can
   * identify works.
   */
  from: Record<string, unknown>
}

export interface FragmentHookResult<TData = any> {
  /**
   * The fragment data read from Apollo Client's cache, or `undefined` if the
   * cache doesn't (yet) contain complete data for the fragment.
   */
  data: TData | undefined
  complete: boolean
}

export type FragmentIdentifier = string | number

export type CacheKey = {
  __typename: string
  id: FragmentIdentifier
}

export type RegisterFragmentResult = {
  fragment: DocumentNode
  typename: string
  getCacheKey: (id: FragmentIdentifier) => CacheKey
  useRegisteredFragment: <TData = any>(
    id: FragmentIdentifier,
  ) => UseFragmentResult<TData>
}

/*
 * Get the typename from a fragment.
 */
const getTypenameFromFragment = (fragment: DocumentNode): string => {
  const [definition] = getFragmentDefinitions(fragment)
  return definition.typeCondition.name.value
}

/**
 *
 * Relies on the useFragment hook which represents a lightweight
 * live binding into the Apollo Client Cache.
 *
 * It enables Apollo Client to broadcast specific fragment results to
 * individual components.
 *
 * This hook returns an always-up-to-date view of whatever data the
 * cache currently contains for a given fragment.
 *
 * useFragment never triggers network requests of its own.
 *
 * @see https://www.apollographql.com/docs/react/api/react/hooks#usefragment
 */
const useRegisteredFragmentHook = <TData = any>(
  fragment: DocumentNode,
  id: string | number,
): UseFragmentResult<TData> => {
  const from = { __typename: getTypenameFromFragment(fragment), id }

  return apolloClient.useFragment({
    fragment,
    from,
  })
}

/**
 * Passed to Apollo's `useFragment` when the object a fragment Cell received
 * in its data prop can't be identified in the cache (for example because the
 * fragment doesn't select the type's key fields). It identifies nothing, so
 * the read comes back incomplete and the Cell falls back to the data
 * snapshot it was passed.
 */
const UNIDENTIFIABLE_FRAGMENT_REF = 'CedarUnidentifiableFragmentRef:_'

/**
 * Read fragment data from Apollo Client's cache without firing a network
 * request. Used by fragment Cells (Cells that export `FRAGMENT` instead of
 * `QUERY`). Incomplete reads surface `data: undefined` so that fragment Cells
 * fall back to the data snapshot passed via their data prop.
 */
export function useFragment<TData = any>(
  options: FragmentHookOptions,
): FragmentHookResult<TData> {
  const client = apolloClient.useApolloClient()
  const { from, ...restOptions } = options

  // `FragmentHookOptions` types `from` as a plain object, which is what
  // Apollo's `StoreObject` is – but `StoreObject` types
  // `__typename` as `string | undefined`, which `unknown` isn't assignable to
  const cacheId = client.cache.identify(from as apolloClient.StoreObject)

  const result = apolloClient.useFragment<TData>({
    ...restOptions,
    // We identify the object ourselves (above) because passing an
    // unidentifiable object to `useFragment` logs a warning and returns a
    // useless `{ data: {}, complete: true }` result
    from: cacheId ?? UNIDENTIFIABLE_FRAGMENT_REF,
  })

  if (cacheId !== undefined && result.complete) {
    return { data: result.data, complete: true }
  }

  return { data: undefined, complete: false }
}

/**
 * Creates a fragment registry for Apollo Client's InMemoryCache so that they
 * can be referred to by name in any query or InMemoryCache operation
 * (such as cache.readFragment, cache.readQuery and cache.watch)
 * without needing to interpolate their declaration.
 *
 * @see https://www.apollographql.com/docs/react/data/fragments/#registering-named-fragments-using-createfragmentregistry
 **/
export const fragmentRegistry: FragmentRegistryAPI = createFragmentRegistry()

/**
 * Registers a list of fragments with the fragment registry.
 */
export const registerFragments = (fragments: DocumentNode[]) => {
  return fragments.map(registerFragment)
}

/**
 * Registers a fragment with the fragment registry.
 *
 * It returns a set of utilities for working with the fragment, including:
 * - the fragment itself
 * - the typename of the fragment
 * - a function to get the cache key for a given id
 * - a hook to use the registered fragment in a component by id
 * that returns cached data for the fragment
 *
 * Note: one does not need to use the hook, cacheKey to use the fragment in queries.
 *
 * @see https://www.apollographql.com/docs/react/data/fragments/#registering-named-fragments-using-createfragmentregistry
 */
export const registerFragment = (
  fragment: DocumentNode,
): RegisterFragmentResult => {
  fragmentRegistry.register(fragment)

  const typename = getTypenameFromFragment(fragment)

  const getCacheKey = (id: FragmentIdentifier): CacheKey => {
    return { __typename: typename, id }
  }

  const useRegisteredFragment = <TData = any>(
    id: FragmentIdentifier,
  ): UseFragmentResult<TData> => {
    return useRegisteredFragmentHook<TData>(fragment, id)
  }

  return {
    fragment,
    typename,
    getCacheKey,
    useRegisteredFragment,
  }
}
