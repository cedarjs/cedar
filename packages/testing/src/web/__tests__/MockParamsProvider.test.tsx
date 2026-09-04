import React from 'react'

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { LocationProvider, useParams } from '@cedarjs/router'

import { MockParamsProvider } from '../MockParamsProvider.js'
import { mockRouteParams } from '../mockRequests.js'

const ParamsDisplay = () => {
  const params = useParams()

  return <div data-testid="params">{JSON.stringify(params)}</div>
}

describe('MockParamsProvider', () => {
  it('exposes params set with mockRouteParams() to useParams()', () => {
    mockRouteParams({ orgSlug: 'acme' })

    render(
      <LocationProvider>
        <MockParamsProvider>
          <ParamsDisplay />
        </MockParamsProvider>
      </LocationProvider>,
    )

    expect(screen.getByTestId('params')).toHaveTextContent(
      JSON.stringify({ orgSlug: 'acme' }),
    )
  })

  it('lets route params set with mockRouteParams() take precedence over the URL search string', () => {
    mockRouteParams({ orgSlug: 'from-mock' })

    render(
      <LocationProvider
        location={new URL('https://example.com/?orgSlug=from-url')}
      >
        <MockParamsProvider>
          <ParamsDisplay />
        </MockParamsProvider>
      </LocationProvider>,
    )

    expect(screen.getByTestId('params')).toHaveTextContent(
      JSON.stringify({ orgSlug: 'from-mock' }),
    )
  })
})
