import React from 'react'

import { loadErrorMessages, loadDevMessages } from '@apollo/client/dev'
import {
  useBackgroundQuery,
  useReadQuery,
} from '@apollo/client/react/hooks/hooks.cjs'
import { render, screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { vi, describe, beforeAll, beforeEach, test } from 'vitest'

import { createSuspendingCell } from './createSuspendingCell.js'

vi.mock('@apollo/client/react/hooks/hooks.cjs', () => {
  return {
    useApolloClient: vi.fn(),
    useBackgroundQuery: vi.fn(),
    useReadQuery: vi.fn(),
  }
})

// The tests fake the hooks with minimal objects rather than full Apollo
// results, so the mocks are typed loosely instead of with Apollo's overloaded
// hook signatures
const mockUseBackgroundQuery = useBackgroundQuery as unknown as Mock
const mockUseReadQuery = useReadQuery as unknown as Mock

// @TODO: once we have finalised implementation, we need to add tests for
// all the other states. We would also need to figure out how to test the Suspense state.
// No point doing this now, as the implementation is in flux!

describe('createSuspendingCell', () => {
  beforeAll(() => {
    globalThis.RWJS_ENV = {
      RWJS_EXP_STREAMING_SSR: true,
    }
    loadDevMessages()
    loadErrorMessages()
  })

  beforeEach(() => {
    mockUseReadQuery.mockReset()
    mockUseBackgroundQuery.mockReset()
    mockUseBackgroundQuery.mockImplementation(() => {
      return ['mocked-query-ref', { refetch: vi.fn(), fetchMore: vi.fn() }]
    })
  })

  test('Renders a static Success component', () => {
    const TestCell = createSuspendingCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
    })

    mockUseReadQuery.mockImplementation(() => ({ data: {} }))

    render(<TestCell />)
    screen.getByText(/^Great success!$/)
  })

  test('Renders Success with data', () => {
    const TestCell = createSuspendingCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: ({ answer }) => (
        <>
          <dl>
            <dt>What&apos;s the meaning of life?</dt>
            <dd>{answer}</dd>
          </dl>
        </>
      ),
    })

    mockUseReadQuery.mockImplementation(() => {
      return { data: { answer: 42 } }
    })

    render(<TestCell />)

    screen.getByText(/^What's the meaning of life\?$/)
    screen.getByText(/^42$/)
  })

  test('Renders Success if any of the fields have data (i.e. not just the first)', () => {
    const TestCell = createSuspendingCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { users { name } posts { title } }',
      Empty: () => <>No users or posts</>,
      Success: ({ users, posts }) => (
        <>
          <div>
            {users.length > 0 ? (
              <ul>
                {users.map(({ name }) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : (
              'no users'
            )}
          </div>
          <div>
            {posts.length > 0 ? (
              <ul>
                {posts.map(({ title }) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            ) : (
              'no posts'
            )}
          </div>
        </>
      ),
    })

    mockUseReadQuery.mockImplementation(() => {
      return {
        data: {
          users: [],
          posts: [{ title: 'bazinga' }, { title: 'kittens' }],
        },
      }
    })

    render(<TestCell />)

    screen.getByText(/bazinga/)
    screen.getByText(/kittens/)
  })
})
