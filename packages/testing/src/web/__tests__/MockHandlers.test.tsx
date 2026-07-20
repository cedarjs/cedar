import React, { useCallback, useState } from 'react'

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

import { mockGraphQLQuery } from '../mockRequests.js'

vi.setConfig({ testTimeout: 6_000 })

describe('GraphQLMockHandlers', () => {
  it('resolves async mock-data functions before serializing the response', async () => {
    mockGraphQLQuery('GetAsyncArticle', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))

      return { article: { id: 7, title: 'Async title' } }
    })

    const response = await fetch('https://example.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          query GetAsyncArticle {
            article {
              id
              title
            }
          }
        `,
      }),
    })

    // Without awaiting the callback the pending promise serializes to `{}`
    expect(await response.json()).toEqual({
      data: { article: { id: 7, title: 'Async title' } },
    })
  })

  it('should allow you to compose mock graphql handlers for more complex tests', async () => {
    const baseResult = {
      article: {
        id: 1,
        title: 'Foobar',
        body: 'Lorem ipsum...',
      },
    }
    const onceResult = {
      article: {
        id: 1,
        title: 'Foobar1',
        body: 'Lorem ipsum123...',
      },
    }
    // Create the base response that always returns
    mockGraphQLQuery('GetArticle', () => baseResult)
    // Create a one time handler
    mockGraphQLQuery('GetArticle', () => onceResult, 'once')

    const FakeComponent = () => {
      const [result, setResult] = useState()
      const [fetching, setFetching] = useState(false)

      const doFetch = useCallback(() => {
        setFetching(true)
        fetch('https://example.com/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `
                query GetArticle($id: ID!) {
                  article(id: $id) {
                    id
                    title
                    body
                  }
                }
              `,
            variables: {
              id: 1,
            },
          }),
        })
          .then(async (result) => {
            const data = await result.json()
            setResult(data)
          })
          .catch((err) => {
            console.error('err', err)
          })
          .finally(() => setFetching(false))
      }, [])

      return (
        <div>
          <button data-testid="fetch" onClick={doFetch}>
            Fetch
          </button>
          <div data-testid="result">{JSON.stringify(result)}</div>
          <div data-testid="status">{String(fetching)}</div>
        </div>
      )
    }

    render(<FakeComponent />)

    const button = screen.getByTestId('fetch')
    const result = screen.getByTestId('result')
    const status = screen.getByTestId('status')

    fireEvent.click(button)

    await waitFor(
      () =>
        expect(JSON.parse(result.textContent || '')).toEqual({
          data: onceResult,
        }),
      {
        timeout: 2_000,
      },
    )

    fireEvent.click(button)

    await waitFor(
      () =>
        expect(JSON.parse(result.textContent || '')).toEqual({
          data: baseResult,
        }),
      {
        timeout: 2_000,
      },
    )

    fireEvent.click(button)

    await waitFor(
      () => {
        expect(status).toHaveTextContent('false')
        expect(JSON.parse(result.textContent || '')).toEqual({
          data: baseResult,
        })
      },
      {
        timeout: 2_000,
      },
    )
  })
})
