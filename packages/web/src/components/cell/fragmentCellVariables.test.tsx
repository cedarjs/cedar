import React from 'react'

import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { render, screen } from '@testing-library/react'
import { parse } from 'graphql'
import { describe, beforeEach, test } from 'vitest'

import { fragmentRegistry } from '../../apollo/fragmentRegistry.js'

import { withOperationVariableDefaults } from './CellOperationVariablesContext.js'
import { createCell } from './createCell.js'
import { createSuspendingCell } from './createSuspendingCell.js'

// These tests use a real Apollo Client cache. Parent Cells pass their
// fragment Cells only a cache reference (`{ __typename, id }`), so the only
// way for a fragment Cell to render its fields is a complete cache read, which
// for fields with arguments needs the operation's variables

const CommentsCell = createCell({
  FRAGMENT: parse(`
    fragment CommentsCellFragment on Post {
      id
      comments(first: $count) {
        id
        body
      }
    }
  `),
  displayName: 'CommentsCell',
  Success: ({ post }: { post: { comments?: { body: string }[] } }) => (
    <>Comments: {post.comments?.map((c) => c.body).join(', ') ?? 'none'}</>
  ),
})

const PostCell = createCell({
  FRAGMENT: parse(`
    fragment PostCellFragment on Post {
      id
      title
      ...CommentsCellFragment
    }
  `),
  displayName: 'PostCell',
  Success: ({ post }: { post: { id: number; title: string } }) => (
    <>
      <h1>{post.title}</h1>
      <CommentsCell post={{ __typename: 'Post', id: post.id }} />
    </>
  ),
})

const POST_DATA = {
  post: {
    __typename: 'Post',
    id: 1,
    title: 'Hello',
    comments: [
      { __typename: 'Comment', id: 1, body: 'First' },
      { __typename: 'Comment', id: 2, body: 'Second' },
    ],
  },
}

function makeClient() {
  return new ApolloClient({
    cache: new InMemoryCache({ fragments: fragmentRegistry }),
    link: ApolloLink.empty(),
  })
}

function cacheOnly(props: Record<string, unknown>) {
  return { variables: props, fetchPolicy: 'cache-only' as const }
}

describe('fragment Cells reading fields that use operation variables', () => {
  beforeEach(() => {
    globalThis.RWJS_ENV = { RWJS_EXP_STREAMING_SSR: false }
  })

  test('read the fields with the query Cell’s variables', async () => {
    const QUERY = parse(`
      query FindPost($id: Int!, $count: Int!) {
        post(id: $id) {
          ...CommentsCellFragment
        }
      }
    `)
    const client = makeClient()
    client.writeQuery({
      query: client.cache.transformDocument(QUERY),
      variables: { id: 1, count: 2 },
      data: POST_DATA,
    })

    const FindPostCell = createCell({
      QUERY,
      beforeQuery: cacheOnly,
      Success: ({ post }: { post: { id: number } }) => (
        <CommentsCell post={{ __typename: 'Post', id: post.id }} />
      ),
    })

    render(
      <ApolloProvider client={client}>
        <FindPostCell id={1} count={2} />
      </ApolloProvider>,
    )

    await screen.findByText(/^Comments: First, Second$/)
  })

  test('read the fields with the query’s default variable values', async () => {
    const QUERY = parse(`
      query FindPostWithDefault($id: Int!, $count: Int = 2) {
        post(id: $id) {
          ...CommentsCellFragment
        }
      }
    `)
    const client = makeClient()
    client.writeQuery({
      query: client.cache.transformDocument(QUERY),
      variables: { id: 1 },
      data: POST_DATA,
    })

    const FindPostCell = createCell({
      QUERY,
      beforeQuery: cacheOnly,
      Success: ({ post }: { post: { id: number } }) => (
        <CommentsCell post={{ __typename: 'Post', id: post.id }} />
      ),
    })

    render(
      <ApolloProvider client={client}>
        <FindPostCell id={1} />
      </ApolloProvider>,
    )

    await screen.findByText(/^Comments: First, Second$/)
  })

  test('pass the variables on to nested fragment Cells', async () => {
    const QUERY = parse(`
      query FindPostNested($id: Int!, $count: Int!) {
        post(id: $id) {
          ...PostCellFragment
        }
      }
    `)
    const client = makeClient()
    client.writeQuery({
      query: client.cache.transformDocument(QUERY),
      variables: { id: 1, count: 2 },
      data: POST_DATA,
    })

    const FindPostCell = createCell({
      QUERY,
      beforeQuery: cacheOnly,
      Success: ({ post }: { post: { id: number } }) => (
        <PostCell post={{ __typename: 'Post', id: post.id }} />
      ),
    })

    render(
      <ApolloProvider client={client}>
        <FindPostCell id={1} count={2} />
      </ApolloProvider>,
    )

    await screen.findByText(/^Hello$/)
    await screen.findByText(/^Comments: First, Second$/)
  })

  test('re-render when the cache entry for the variables changes', async () => {
    const QUERY = parse(`
      query FindPostLive($id: Int!, $count: Int!) {
        post(id: $id) {
          ...CommentsCellFragment
        }
      }
    `)
    const client = makeClient()
    client.writeQuery({
      query: client.cache.transformDocument(QUERY),
      variables: { id: 1, count: 2 },
      data: POST_DATA,
    })

    const FindPostCell = createCell({
      QUERY,
      beforeQuery: cacheOnly,
      Success: ({ post }: { post: { id: number } }) => (
        <CommentsCell post={{ __typename: 'Post', id: post.id }} />
      ),
    })

    render(
      <ApolloProvider client={client}>
        <FindPostCell id={1} count={2} />
      </ApolloProvider>,
    )

    await screen.findByText(/^Comments: First, Second$/)

    client.cache.writeFragment({
      id: 'Comment:2',
      fragment: parse(`fragment UpdatedComment on Comment { body }`),
      data: { body: 'Edited' },
    })

    await screen.findByText(/^Comments: First, Edited$/)
  })

  test('read the fields with a streaming Cell’s variables', async () => {
    globalThis.RWJS_ENV = { RWJS_EXP_STREAMING_SSR: true }

    const QUERY = parse(`
      query FindPostStreaming($id: Int!, $count: Int = 2) {
        post(id: $id) {
          ...CommentsCellFragment
        }
      }
    `)
    const client = makeClient()
    client.writeQuery({
      query: client.cache.transformDocument(QUERY),
      variables: { id: 1 },
      data: POST_DATA,
    })

    const FindPostCell = createSuspendingCell({
      QUERY,
      // Suspense hooks don't support `cache-only`. The data is already in the
      // cache, so `cache-first` doesn't hit the (empty) link either
      beforeQuery: (props) => ({
        variables: props,
        fetchPolicy: 'cache-first' as const,
      }),
      Loading: () => <>Loading...</>,
      Success: ({ post }: { post: { id: number } }) => (
        <CommentsCell post={{ __typename: 'Post', id: post.id }} />
      ),
    })

    render(
      <ApolloProvider client={client}>
        <FindPostCell id={1} />
      </ApolloProvider>,
    )

    await screen.findByText(/^Comments: First, Second$/)
  })
})

describe('withOperationVariableDefaults', () => {
  const QUERY = parse(`
    query Q($a: Int = 1, $b: String = "x", $c: [Int] = [1, 2], $d: Int) {
      field
    }
  `)

  test('applies defaults for missing and undefined variables', ({ expect }) => {
    expect(withOperationVariableDefaults(QUERY, { b: undefined })).toEqual({
      a: 1,
      b: 'x',
      c: [1, 2],
    })
  })

  test('keeps passed values, including null', ({ expect }) => {
    expect(
      withOperationVariableDefaults(QUERY, { a: 5, b: null, d: 3, e: 'extra' }),
    ).toEqual({ a: 5, b: null, c: [1, 2], d: 3, e: 'extra' })
  })
})
