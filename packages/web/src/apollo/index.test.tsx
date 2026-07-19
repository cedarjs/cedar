import React from 'react'

import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, test, expect } from 'vitest'

import { RedwoodApolloProvider } from './index.js'

globalThis.RWJS_API_GRAPHQL_URL = 'https://example.com/graphql'

describe('RedwoodApolloProvider smoke test', () => {
  test('renders children and runs a query through the full link chain', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { answer: 42 } }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

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

    render(
      <RedwoodApolloProvider>
        <Consumer />
      </RedwoodApolloProvider>,
    )

    await waitFor(() => screen.getByText('answer: 42'))
    expect(fetchMock).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
