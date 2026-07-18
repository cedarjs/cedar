import React from 'react'

import { render, screen } from '@testing-library/react'
import { parse } from 'graphql'
import { vi, describe, beforeAll, test, expect } from 'vitest'

import type { FragmentHookOptions } from '../GraphQLHooksProvider.js'
import { GraphQLHooksProvider } from '../GraphQLHooksProvider.js'

import { createCell } from './createCell.js'

const AUTHOR_FRAGMENT = parse(`
  fragment AuthorCell_author on User {
    email
    fullName
  }
`)

describe('createFragmentCell', () => {
  beforeAll(() => {
    globalThis.RWJS_ENV = {
      RWJS_EXP_STREAMING_SSR: false,
    }
  })

  test('renders Success with data from the _ref prop', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    render(
      // No useFragment hook registered, so the Cell falls back to reading
      // data straight off the `_ref` prop
      <GraphQLHooksProvider useQuery={null} useMutation={null}>
        <TestCell
          _ref={{ __typename: 'User', id: 1, fullName: 'Story Teller' }}
        />
      </GraphQLHooksProvider>,
    )

    screen.getByText(/^By Story Teller$/)
  })

  test('prefers complete data from the useFragment hook', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    const myUseFragmentHook = (options: FragmentHookOptions) => {
      expect(options.fragmentName).toEqual('AuthorCell_author')
      expect(options.from).toEqual({ __typename: 'User', id: 1 })

      return {
        data: { fullName: 'Cache Dweller' },
        complete: true,
      }
    }

    render(
      <GraphQLHooksProvider
        useQuery={null}
        useMutation={null}
        useFragment={myUseFragmentHook}
      >
        <TestCell _ref={{ __typename: 'User', id: 1 }} />
      </GraphQLHooksProvider>,
    )

    screen.getByText(/^By Cache Dweller$/)
  })

  test('falls back to the _ref prop for incomplete useFragment reads', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    const myUseFragmentHook = () => {
      return { data: undefined, complete: false }
    }

    render(
      <GraphQLHooksProvider
        useQuery={null}
        useMutation={null}
        useFragment={myUseFragmentHook}
      >
        <TestCell
          _ref={{ __typename: 'User', id: 1, fullName: 'Ref Reader' }}
        />
      </GraphQLHooksProvider>,
    )

    screen.getByText(/^By Ref Reader$/)
  })

  test('derives the prop name from the fragment type when there is no underscore', () => {
    const TestCell = createCell({
      FRAGMENT: parse(`
        fragment AuthorBio on User {
          bio
        }
      `),
      Success: ({ user }) => <>{user.bio}</>,
    })

    render(
      <GraphQLHooksProvider useQuery={null} useMutation={null}>
        <TestCell _ref={{ __typename: 'User', id: 1, bio: 'Writes things' }} />
      </GraphQLHooksProvider>,
    )

    screen.getByText(/^Writes things$/)
  })

  test('renders Empty when isEmpty says so', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      isEmpty: () => true,
      Empty: () => <>Nothing to see</>,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    render(
      <GraphQLHooksProvider useQuery={null} useMutation={null}>
        <TestCell _ref={{ __typename: 'User', id: 1, fullName: 'Nobody' }} />
      </GraphQLHooksProvider>,
    )

    screen.getByText(/^Nothing to see$/)
  })

  test('applies afterQuery to the fragment data', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      afterQuery: (data) => ({
        author: { ...data.author, fullName: 'Changed Name' },
      }),
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    render(
      <GraphQLHooksProvider useQuery={null} useMutation={null}>
        <TestCell
          _ref={{ __typename: 'User', id: 1, fullName: 'Original Name' }}
        />
      </GraphQLHooksProvider>,
    )

    screen.getByText(/^By Changed Name$/)
  })

  test('throws a helpful error when no _ref prop is passed', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
      displayName: 'AuthorCell',
    })

    // React logs the error to console.error before it propagates. Silence it
    // to keep the test output clean
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    try {
      expect(() => {
        render(
          <GraphQLHooksProvider useQuery={null} useMutation={null}>
            <TestCell />
          </GraphQLHooksProvider>,
        )
      }).toThrow(/_ref/)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  test('throws when the FRAGMENT export is not a fragment', () => {
    expect(() =>
      createCell({
        FRAGMENT: parse('query FindAuthor { author { id } }'),
        Success: () => <>hello</>,
      }),
    ).toThrow(/fragment definition/)
  })
})
