import type { NormalizedCacheObject } from '@apollo/client'
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { gql } from 'graphql-tag'
import { describe, expect, test } from 'tstyche'

import { useCache } from '@cedarjs/web/apollo'

// Importing `@cedarjs/web` pulls in the `TypeOverrides` augmentation that
// tells Apollo Client the cache is always an `InMemoryCache`.
import '@cedarjs/web'

describe('Apollo Client cache type', () => {
  test('client.cache is an InMemoryCache', () => {
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
    })

    expect(client.cache).type.toBe<InMemoryCache>()
  })

  test('useApolloClient().cache is an InMemoryCache', () => {
    const client = useApolloClient()

    expect(client.cache).type.toBe<InMemoryCache>()
  })

  test('useCache() exposes an InMemoryCache and typed extract()', () => {
    const { cache, extract } = useCache()

    expect(cache).type.toBe<InMemoryCache>()
    expect(extract()).type.toBe<NormalizedCacheObject>()
    expect(cache.extract()).type.toBe<NormalizedCacheObject>()
  })

  test('mutation update callbacks receive an InMemoryCache', () => {
    const MUTATION = gql`
      mutation DeleteRecipe($id: String!) {
        deleteRecipe(id: $id) {
          id
        }
      }
    `

    useMutation(MUTATION, {
      update(cache) {
        expect(cache).type.toBe<InMemoryCache>()
      },
    })
  })
})
