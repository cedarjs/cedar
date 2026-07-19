import React from 'react'

import { useApolloClient, useFragment } from '@apollo/client'
import { useQuery } from '@apollo/client/react/hooks/hooks.cjs'
import { render, screen } from '@testing-library/react'
import { parse } from 'graphql'
import type { Mock } from 'vitest'
import { vi, describe, beforeAll, beforeEach, test, expect } from 'vitest'

import { fragmentRegistry } from '../../apollo/fragmentRegistry.js'

import { createCell } from './createCell.js'

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useApolloClient: vi.fn(),
    useFragment: vi.fn(),
  }
})

vi.mock('@apollo/client/react/hooks/hooks.cjs', () => ({
  useQuery: vi.fn(),
}))

// The tests fake the hooks with minimal objects rather than full Apollo
// results, so the mocks are typed loosely instead of with Apollo's hook
// signatures
const mockUseApolloClient = useApolloClient as unknown as Mock
const mockApolloUseFragment = useFragment as unknown as Mock
const mockUseQuery = useQuery as unknown as Mock

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

  beforeEach(() => {
    mockApolloUseFragment.mockReset()
    mockUseApolloClient.mockReset()

    mockUseApolloClient.mockReturnValue({
      cache: {
        identify: (obj: Record<string, unknown>) =>
          obj.__typename && obj.id !== undefined
            ? `${obj.__typename}:${obj.id}`
            : undefined,
      },
    })
    // An incomplete cache read by default, so Cells fall back to reading data
    // straight off their data prop
    mockApolloUseFragment.mockReturnValue({ data: undefined, complete: false })
  })

  test('renders Success with data from its data prop', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    render(
      <TestCell
        author={{ __typename: 'User', id: 1, fullName: 'Story Teller' }}
      />,
    )

    screen.getByText(/^By Story Teller$/)
  })

  test('prefers complete data from the cache', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    mockApolloUseFragment.mockImplementation((options) => {
      expect(options.fragmentName).toEqual('AuthorCell_author')
      // `useFragment` identifies the object itself before passing it on to
      // Apollo's `useFragment`
      expect(options.from).toEqual('User:1')

      return {
        data: { fullName: 'Cache Dweller' },
        complete: true,
      }
    })

    render(<TestCell author={{ __typename: 'User', id: 1 }} />)

    screen.getByText(/^By Cache Dweller$/)
  })

  test('falls back to the data prop for incomplete cache reads', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    mockApolloUseFragment.mockReturnValue({ data: undefined, complete: false })

    render(
      <TestCell
        author={{ __typename: 'User', id: 1, fullName: 'Ref Reader' }}
      />,
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
      <TestCell user={{ __typename: 'User', id: 1, bio: 'Writes things' }} />,
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
      <TestCell author={{ __typename: 'User', id: 1, fullName: 'Nobody' }} />,
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
      <TestCell
        author={{ __typename: 'User', id: 1, fullName: 'Original Name' }}
      />,
    )

    screen.getByText(/^By Changed Name$/)
  })

  test('renders Empty when the data prop is null', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Empty: () => <>No author</>,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    // A nullable field, or a partial error with `errorPolicy: 'all'`, can
    // make the parent pass null here
    render(<TestCell author={null} />)

    screen.getByText(/^No author$/)
  })

  test('renders Success with null data when the data prop is null and there is no Empty', () => {
    const TestCell = createCell({
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author?.fullName ?? 'unknown'}</>,
    })

    render(<TestCell author={null} />)

    screen.getByText(/^By unknown$/)
  })

  test('throws a helpful error naming the prop when it is not passed', () => {
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
        render(<TestCell />)
      }).toThrow(/`author` prop/)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  test('stays a query Cell when both QUERY and FRAGMENT are exported', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query AuthorQuery { author { fullName } }',
      FRAGMENT: AUTHOR_FRAGMENT,
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    mockUseQuery.mockImplementation(() => {
      return { data: { author: { fullName: 'Query Result' } } }
    })

    render(<TestCell />)

    screen.getByText(/^By Query Result$/)
  })

  test('registers the FRAGMENT even when the Cell stays a query Cell', () => {
    createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query MixedExportQuery { author { fullName } }',
      // Using a unique fragment name since the registry is shared between
      // tests
      FRAGMENT: parse(`
        fragment MixedExportCell_author on User {
          fullName
        }
      `),
      Success: ({ author }) => <>By {author.fullName}</>,
    })

    // Other Cells can spread the helper fragment by name, so it must be
    // resolvable through the registry
    expect(fragmentRegistry.lookup('MixedExportCell_author')).toBeTruthy()
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
