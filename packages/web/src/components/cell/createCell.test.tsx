import React from 'react'

import { useQuery } from '@apollo/client/react/hooks/hooks.cjs'
import { render, screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { vi, describe, beforeAll, beforeEach, test, expect } from 'vitest'

import { createCell } from './createCell.js'

vi.mock('@apollo/client/react/hooks/hooks.cjs', () => ({
  useQuery: vi.fn(),
}))

// The tests fake `useQuery` with minimal objects rather than full Apollo
// `QueryResult`s, so the mock is typed loosely instead of with Apollo's
// `useQuery` signature
const mockUseQuery = useQuery as unknown as Mock

describe('createCell', () => {
  beforeAll(() => {
    globalThis.RWJS_ENV = {
      RWJS_EXP_STREAMING_SSR: false,
    }
  })

  beforeEach(() => {
    mockUseQuery.mockReset()
  })

  test('Renders a static Success component', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
    })

    mockUseQuery.mockImplementation(() => ({ data: {} }))

    render(<TestCell />)
    screen.getByText(/^Great success!$/)
  })

  test('Renders Success with data', () => {
    const TestCell = createCell({
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

    mockUseQuery.mockImplementation(() => {
      return { data: { answer: 42 } }
    })

    render(<TestCell />)

    screen.getByText(/^What's the meaning of life\?$/)
    screen.getByText(/^42$/)
  })

  test('Renders Success if any of the fields have data (i.e. not just the first)', () => {
    const TestCell = createCell({
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

    mockUseQuery.mockImplementation(() => {
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

  test('Renders default Loading when there is no data', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
    })

    mockUseQuery.mockImplementation(() => ({ loading: true }))

    render(<TestCell />)
    screen.getByText(/^Loading...$/)
  })

  test('Renders custom Loading when there is no data', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
      Loading: () => <>Fetching answer...</>,
    })

    mockUseQuery.mockImplementation(() => ({ loading: true }))

    render(<TestCell />)
    screen.getByText(/^Fetching answer...$/)
  })

  test('Renders Success even when `loading` is true if there is data', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
      Loading: () => <>Fetching answer...</>,
    })

    mockUseQuery.mockImplementation(() => ({ loading: true, data: {} }))

    render(<TestCell />)
    screen.getByText(/^Great success!$/)
  })

  test('Renders Empty if available, and data field is null', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
      Empty: () => <>No one knows</>,
    })

    mockUseQuery.mockImplementation(() => ({
      loading: true,
      data: { answer: null },
    }))

    render(<TestCell />)
    screen.getByText(/^No one knows$/)
  })

  test('Renders Empty if available, and data field is an empty array', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answers }',
      Success: () => <>Great success!</>,
      Empty: () => <>No one knows</>,
    })

    mockUseQuery.mockImplementation(() => ({
      loading: true,
      data: { answers: [] },
    }))

    render(<TestCell />)
    screen.getByText(/^No one knows$/)
  })

  test('Renders Success even if data is empty when no Empty is available', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Empty success</>,
    })

    mockUseQuery.mockImplementation(() => ({
      loading: true,
      data: { answer: null },
    }))

    render(<TestCell />)
    screen.getByText(/^Empty success$/)
  })

  test('Allows passing children to Success', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: ({ children }) => <>Look at my beautiful {children}</>,
    })

    mockUseQuery.mockImplementation(() => ({ data: {} }))

    render(
      <TestCell>
        <div>🦆</div>
      </TestCell>,
    )
    screen.getByText(/^Look at my beautiful$/)
    screen.getByText(/^🦆$/)
  })

  test('Cell props are passed to the query as variables', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: `query Greet($name: String!) {
        greet(name: $name) {
          greeting
        }
      }`,
      Success: ({ greeting }) => <p>{greeting}</p>,
    })

    mockUseQuery.mockImplementation((_query: any, options: any) => {
      return { data: { greeting: `Hello ${options.variables.name}!` } }
    })

    render(<TestCell name="Bob" />)

    screen.getByText(/^Hello Bob!$/)
  })

  test('Allows QUERY to be a function', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: ({ variables }) => {
        if ((variables as any).character === 'BEAST') {
          return 'query BeastQuery { name }'
        }

        return 'query HeroQuery { name }'
      },
      Success: ({ name }) => <p>Call me {name}</p>,
    })

    mockUseQuery.mockImplementation((query: any) => {
      if (query.includes('BeastQuery')) {
        return { data: { name: 'Boogeyman' } }
      } else if (query.includes('HeroQuery')) {
        return { data: { name: 'Lara Croft' } }
      }

      return { data: { name: 'John Doe' } }
    })

    render(
      <>
        <TestCell character="BEAST" />
        <TestCell character="HERO" />
      </>,
    )

    screen.getByText(/^Call me Boogeyman$/)
    screen.getByText(/^Call me Lara Croft$/)
  })

  test('Renders Failure when there is an error', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Failure: () => <>Sad face :(</>,
      Success: () => <>Great success!</>,
      Loading: () => <>Fetching answer...</>,
    })

    mockUseQuery.mockImplementation(() => ({ error: true }))

    render(<TestCell />)
    screen.getByText(/^Sad face :\($/)
  })

  test('Passes error to Failure component', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Failure: ({ error }) => <>{JSON.stringify(error)}</>,
      Success: () => <>Great success!</>,
      Loading: () => <>Fetching answer...</>,
    })

    mockUseQuery.mockImplementation(() => ({
      error: { msg: 'System malfunction' },
    }))

    render(<TestCell />)
    screen.getByText(/^{"msg":"System malfunction"}$/)
  })

  test('Passes error and errorCode to Failure component', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Failure: ({ error, errorCode }) => (
        <>
          {JSON.stringify(error)},code:{errorCode}
        </>
      ),
      Success: () => <>Great success!</>,
      Loading: () => <>Fetching answer...</>,
    })

    mockUseQuery.mockImplementation(() => ({
      error: { msg: 'System malfunction' },
      errorCode: 'SIMON_SAYS_NO',
    }))

    render(<TestCell />)
    screen.getByText(/^{"msg":"System malfunction"},code:SIMON_SAYS_NO$/)
  })

  test('Passes children to Failure', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Failure: ({ children }) => <>I&apos;m a failure {children}</>,
    })

    mockUseQuery.mockImplementation(() => ({ error: {} }))

    render(
      <TestCell>
        <div>Child</div>
      </TestCell>,
    )
    screen.getByText(/^I'm a failure$/)
    screen.getByText(/^Child$/)
  })

  test('Throws an error when there is an error if no Failure component exists', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
      Loading: () => <>Fetching answer...</>,
    })

    mockUseQuery.mockImplementation(() => ({
      error: { message: '200 GraphQL' },
    }))

    // Prevent writing to stderr during this render.
    const err = console.error
    console.error = vi.fn()

    let error
    try {
      render(<TestCell />)
    } catch (e) {
      error = e
    }

    expect(error.message).toEqual('200 GraphQL')

    // Restore writing to stderr.
    console.error = err
  })

  test('Allows overriding of default isDataEmpty', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
      Empty: () => <>Got nothing</>,
      isEmpty: () => true,
    })

    mockUseQuery.mockImplementation(() => ({
      data: {},
      loading: false,
    }))

    render(<TestCell />)

    screen.getByText(/^Got nothing$/)
  })

  test('Allows mixing isDataEmpty with custom logic', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: 'query TestQuery { answer }',
      Success: () => <>Great success!</>,
      Empty: () => <>Got nothing</>,
      isEmpty: (data, { isDataEmpty }) =>
        isDataEmpty(data) || data.answer === '0',
    })

    mockUseQuery.mockImplementation(() => ({
      data: { answer: '0' },
      loading: false,
    }))

    render(<TestCell />)

    screen.getByText(/^Got nothing$/)
  })

  test('Allows overriding variables in beforeQuery', () => {
    const TestCell = createCell({
      // @ts-expect-error - Purposefully using a plain string here.
      QUERY: `query Greet($name: String!) {
        greet(name: $name) {
          greeting
        }
      }`,
      Success: ({ greeting }) => <p>{greeting}</p>,
      beforeQuery: () => ({
        variables: {
          name: 'Bob',
        },
      }),
    })

    mockUseQuery.mockImplementation((_query: any, options: any) => {
      return { data: { greeting: `Hello ${options.variables.name}!` } }
    })

    render(<TestCell />)

    screen.getByText(/^Hello Bob!$/)
  })
})
