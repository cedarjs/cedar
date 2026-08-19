import { ApolloClient, ApolloLink, InMemoryCache, gql } from '@apollo/client'
import { firstValueFrom } from 'rxjs'
import { vi, describe, test, expect } from 'vitest'

import { SSELink } from './sseLink.js'

const { subscribeMock } = vi.hoisted(() => {
  return {
    subscribeMock: vi.fn(
      (
        _request: Record<string, unknown>,
        sink: {
          next: (value: unknown) => void
          complete: () => void
        },
      ) => {
        sink.next({ data: { posts: [] } })
        sink.complete()
        return () => {}
      },
    ),
  }
})

vi.mock('graphql-sse', () => ({
  createClient: () => ({ subscribe: subscribeMock }),
}))

describe('SSELink', () => {
  test('sends only spec-compliant fields in the request', async () => {
    const link = new SSELink({
      url: 'https://example.com/graphql',
      auth: { authProviderType: 'custom', tokenFn: async () => null },
    })

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
    })

    const query = gql`
      query LivePosts @live {
        posts {
          id
        }
      }
    `

    const result = await firstValueFrom(
      ApolloLink.execute(link, { query, variables: { a: 1 } }, { client }),
    )

    expect(result).toEqual({ data: { posts: [] } })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    const request = subscribeMock.mock.calls[0][0]

    // Spec-compliant GraphQL servers reject requests with unexpected fields,
    // so make sure no Apollo-internal fields (like `operationType`) leak in
    expect(Object.keys(request).sort()).toEqual([
      'extensions',
      'operationName',
      'query',
      'variables',
    ])
    expect(request.operationName).toEqual('LivePosts')
    expect(typeof request.query).toEqual('string')
    expect(request.variables).toEqual({ a: 1 })
  })

  test('omits the query for operations with a trusted document hash', async () => {
    subscribeMock.mockClear()

    const link = new SSELink({
      url: 'https://example.com/graphql',
      auth: { authProviderType: 'custom', tokenFn: async () => null },
    })

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.empty(),
    })

    const query = gql`
      subscription CountSub {
        count
      }
    `

    await firstValueFrom(
      ApolloLink.execute(
        link,
        {
          query,
          extensions: { persistedQuery: { sha256Hash: 'trusted-doc-hash' } },
        },
        { client },
      ),
    )

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    const request = subscribeMock.mock.calls[0][0]

    expect(request.query).toBeUndefined()
    expect(request.extensions).toEqual({
      persistedQuery: { sha256Hash: 'trusted-doc-hash' },
    })
  })
})
