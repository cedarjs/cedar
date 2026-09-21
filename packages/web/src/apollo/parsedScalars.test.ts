import { ApolloClient, InMemoryCache, gql } from '@apollo/client'
import { MockLink } from '@apollo/client/testing'
import { afterEach, describe, expect, it } from 'vitest'

import type { ParsedScalarsCacheConfig } from './parsedScalars.js'
import { withParsedScalars } from './parsedScalars.js'

const parsedScalarsConfig: ParsedScalarsCacheConfig = {
  scalars: { DateTime: 'Date' },
  typePolicies: {
    Post: { fields: { postedAt: { scalar: 'DateTime' } } },
  },
  inputObjects: {
    UpdatePostInput: { fields: { postedAt: 'DateTime' } },
  },
}

const POST = gql`
  query Post($id: Int!) {
    post(id: $id) {
      __typename
      id
      postedAt
    }
  }
`

const UPDATE_POST = gql`
  mutation UpdatePost($id: Int!, $input: UpdatePostInput!) {
    updatePost(id: $id, input: $input) {
      __typename
      id
      postedAt
    }
  }
`

afterEach(() => {
  delete globalThis.__CEDAR__PARSED_SCALARS
})

describe('withParsedScalars', () => {
  it('returns the cache config as it is when no scalar is parsed', () => {
    const cacheConfig = { possibleTypes: { A: ['B'] } }

    expect(withParsedScalars(cacheConfig)).toBe(cacheConfig)
    expect(withParsedScalars(undefined)).toBeUndefined()
  })

  describe('when a scalar is parsed', () => {
    const postedAt = '2026-09-21T14:30:45.123Z'

    function createClient(
      link: MockLink,
      cacheConfig?: Parameters<typeof withParsedScalars>[0],
    ) {
      globalThis.__CEDAR__PARSED_SCALARS = parsedScalarsConfig

      return new ApolloClient({
        cache: new InMemoryCache(withParsedScalars(cacheConfig)),
        link,
      })
    }

    it('parses a response into Date objects', async () => {
      const client = createClient(
        new MockLink([
          {
            request: { query: POST, variables: { id: 1 } },
            result: {
              data: { post: { __typename: 'Post', id: 1, postedAt } },
            },
          },
        ]),
      )

      const { data } = await client.query({
        query: POST,
        variables: { id: 1 },
      })

      expect(data?.post.postedAt).toBeInstanceOf(Date)
      expect((data?.post.postedAt as unknown as Date).toISOString()).toBe(
        postedAt,
      )
    })

    it('extracts serialized values and parses them again when they are restored', async () => {
      const client = createClient(
        new MockLink([
          {
            request: { query: POST, variables: { id: 1 } },
            result: {
              data: { post: { __typename: 'Post', id: 1, postedAt } },
            },
          },
        ]),
      )

      await client.query({ query: POST, variables: { id: 1 } })

      const extracted = client.cache.extract()

      // What the prerendered HTML carries has to survive JSON
      expect(JSON.parse(JSON.stringify(extracted))).toEqual(extracted)
      expect(JSON.stringify(extracted)).toContain(postedAt)

      const restoredCache = new InMemoryCache(withParsedScalars()).restore(
        JSON.parse(JSON.stringify(extracted)),
      )
      const restored = restoredCache.readQuery({
        query: POST,
        variables: { id: 1 },
      })

      expect(restored?.post.postedAt).toBeInstanceOf(Date)
      expect((restored?.post.postedAt as unknown as Date).toISOString()).toBe(
        postedAt,
      )
    })

    it('serializes Date objects in the variables', async () => {
      const client = createClient(
        new MockLink([
          {
            request: {
              query: UPDATE_POST,
              variables: { id: 1, input: { postedAt } },
            },
            result: {
              data: {
                updatePost: { __typename: 'Post', id: 1, postedAt },
              },
            },
          },
        ]),
      )

      const { data } = await client.mutate({
        mutation: UPDATE_POST,
        variables: { id: 1, input: { postedAt: new Date(postedAt) } },
      })

      expect(data?.updatePost.postedAt).toBeInstanceOf(Date)
    })

    it('keeps the field policies and scalars the app configured', () => {
      globalThis.__CEDAR__PARSED_SCALARS = parsedScalarsConfig

      const merge = () => 'merged'
      const read = () => 'read'

      const config = withParsedScalars({
        typePolicies: {
          Post: {
            keyFields: ['slug'],
            fields: { postedAt: { merge }, title: read },
          },
          Comment: { keyFields: false },
        },
      })

      expect(config?.typePolicies).toEqual({
        Post: {
          keyFields: ['slug'],
          fields: {
            postedAt: { merge, scalar: 'DateTime' },
            title: read,
          },
        },
        Comment: { keyFields: false },
      })
    })

    it('adds the scalar to a field the app configured with a read function', () => {
      globalThis.__CEDAR__PARSED_SCALARS = parsedScalarsConfig

      const read = () => 'read'
      const config = withParsedScalars({
        typePolicies: { Post: { fields: { postedAt: read } } },
      })

      expect(config?.typePolicies?.Post.fields).toEqual({
        postedAt: { read, scalar: 'DateTime' },
      })
    })

    it('throws for a type Cedar cannot parse a scalar into', () => {
      globalThis.__CEDAR__PARSED_SCALARS = {
        ...parsedScalarsConfig,
        scalars: { DateTime: 'Temporal' },
      }

      expect(() => withParsedScalars()).toThrow(
        'Can\'t parse the DateTime scalar into "Temporal". Supported: "Date"',
      )
    })
  })
})
