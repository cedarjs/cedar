import React from 'react'

import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'

import { CedarApolloProvider } from './CedarApolloProvider.js'
import { CedarApolloProvider as SuspenseCedarApolloProvider } from './suspense.js'
import { useCreateApolloClient } from './useCreateApolloClient.js'

globalThis.RWJS_API_GRAPHQL_URL = 'https://example.com/graphql'

const QUERY = gql`
  query AnswerQuery {
    answer
  }
`

const Consumer = () => {
  const { data, loading, error } = useQuery<{ answer: number }>(QUERY)

  if (error) {
    return <>error: {error.message}</>
  }

  if (loading) {
    return <>loading</>
  }

  return <>answer: {data?.answer}</>
}

describe('useCreateApolloClient', () => {
  let requestHeaders: Headers[]

  beforeEach(() => {
    requestHeaders = []
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestHeaders.push(new Headers(init?.headers))
        return new Response(JSON.stringify({ data: { answer: 42 } }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('throws when used outside CedarApolloProvider', () => {
    // Suppress the console noise React logs for an error thrown during render.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Bare = () => {
      useCreateApolloClient()
      return null
    }

    expect(() => render(<Bare />)).toThrow(
      'useCreateApolloClient must be used within a CedarApolloProvider',
    )

    consoleError.mockRestore()
  })

  test('a client built with extra headers carries them; the app client does not', async () => {
    const OrgQueryRunner = () => {
      const createClient = useCreateApolloClient()

      React.useEffect(() => {
        const orgClient = createClient({ headers: { 'cedar-org': 'org_1' } })
        orgClient.query({ query: QUERY, fetchPolicy: 'network-only' })
        // Only build and query the org client once, on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      return null
    }

    render(
      <CedarApolloProvider>
        <Consumer />
        <OrgQueryRunner />
      </CedarApolloProvider>,
    )

    await waitFor(() => screen.getByText('answer: 42'))
    await waitFor(() => expect(requestHeaders).toHaveLength(2))

    const orgRequest = requestHeaders.find((headers) =>
      headers.has('cedar-org'),
    )
    const appRequest = requestHeaders.find(
      (headers) => !headers.has('cedar-org'),
    )

    expect(orgRequest?.get('cedar-org')).toBe('org_1')
    expect(appRequest).toBeDefined()
  })

  test('each call to the factory returns a client with its own cache', () => {
    let createClient!: ReturnType<typeof useCreateApolloClient>

    const CaptureFactory = () => {
      createClient = useCreateApolloClient()
      return null
    }

    render(
      <CedarApolloProvider>
        <CaptureFactory />
      </CedarApolloProvider>,
    )

    const clientA = createClient({ headers: { 'cedar-org': 'org_a' } })
    const clientB = createClient({ headers: { 'cedar-org': 'org_b' } })

    expect(clientA.cache).not.toBe(clientB.cache)
  })
})

describe('useCreateApolloClient (suspense provider)', () => {
  let requestHeaders: Headers[]

  beforeEach(() => {
    requestHeaders = []
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestHeaders.push(new Headers(init?.headers))
        return new Response(JSON.stringify({ data: { answer: 42 } }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('the hook works under the streaming/SSR CedarApolloProvider and its client carries extra headers', async () => {
    let createClient!: ReturnType<typeof useCreateApolloClient>

    const CaptureFactory = () => {
      createClient = useCreateApolloClient()
      return null
    }

    render(
      <SuspenseCedarApolloProvider>
        <CaptureFactory />
      </SuspenseCedarApolloProvider>,
    )

    const orgClient = createClient({ headers: { 'cedar-org': 'org_1' } })
    const clientA = createClient({ headers: { 'cedar-org': 'org_a' } })

    // Each call gets its own fresh cache, same as the non-suspense provider.
    expect(orgClient.cache).not.toBe(clientA.cache)

    await orgClient.query({ query: QUERY, fetchPolicy: 'network-only' })

    expect(requestHeaders).toHaveLength(1)
    expect(requestHeaders[0].get('cedar-org')).toBe('org_1')
  })
})
