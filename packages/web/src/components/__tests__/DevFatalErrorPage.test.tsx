import React from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import { DevFatalErrorPage } from '../DevFatalErrorPage.js'

describe('DevFatalErrorPage', () => {
  let mockWriteText: any

  beforeEach(() => {
    // Set up clipboard mock before each test
    mockWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders error type and message when error is provided', () => {
    const error = new Error('Test error message')

    render(<DevFatalErrorPage error={error} />)

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText(/Test error message/)).toBeInTheDocument()
  })

  it('renders fallback message when no error is provided', () => {
    render(<DevFatalErrorPage />)

    expect(
      screen.getByText(
        /Could not render the error page due to a missing error/,
      ),
    ).toBeInTheDocument()
  })

  it('renders Copy All button', () => {
    const error = new Error('Test error')

    render(<DevFatalErrorPage error={error} />)

    expect(screen.getByRole('button', { name: /Copy All/ })).toBeInTheDocument()
  })

  it('copies error details to clipboard when Copy All button is clicked', async () => {
    const user = userEvent.setup()
    const error = new Error('Test error message')

    render(<DevFatalErrorPage error={error} />)

    const copyButton = screen.getByRole('button', { name: /Copy All/ })
    await user.click(copyButton)

    expect(mockWriteText).toHaveBeenCalledTimes(1)
    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('FATAL ERROR REPORT'),
    )
    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('Test error message'),
    )
  })

  it('shows copy feedback after clicking Copy All', async () => {
    const user = userEvent.setup()
    const error = new Error('Test error')

    render(<DevFatalErrorPage error={error} />)
    const copyButton = screen.getByRole('button', { name: /Copy All/ })
    await user.click(copyButton)

    expect(mockWriteText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('✓ Copied to clipboard')).toBeInTheDocument()
  })

  it('includes request context in clipboard when Copy All is clicked', async () => {
    const user = userEvent.setup()
    const error: any = new Error('GraphQL error')
    error.mostRecentRequest = {
      query: 'query GetUser { user { id } }',
      operationName: 'GetUser',
      operationKind: 'query',
      variables: { id: '123' },
    }

    render(<DevFatalErrorPage error={error} />)

    const copyButton = screen.getByRole('button', { name: /Copy All/ })
    await user.click(copyButton)

    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('REQUEST CONTEXT'),
    )
    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('GetUser'),
    )
    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('"id": "123"'),
    )
  })

  it('includes request context in clipboard if available', () => {
    const error: any = new Error('GraphQL error')
    error.mostRecentRequest = {
      query: 'query GetUser { user { id } }',
      operationName: 'GetUser',
      operationKind: 'query',
      variables: { id: '123' },
    }

    render(<DevFatalErrorPage error={error} />)

    // The request section should render
    const requestHeader = screen.getByText((text, element) => {
      return element?.tagName === 'H4' && text.includes('Request:')
    })
    expect(requestHeader).toBeInTheDocument()
  })

  it('includes response context in clipboard if available', () => {
    const error: any = new Error('GraphQL error')
    error.mostRecentResponse = {
      data: { user: { id: '123', name: 'John' } },
      errors: null,
    }

    render(<DevFatalErrorPage error={error} />)

    // The response section should render
    expect(screen.getByText('Response')).toBeInTheDocument()
  })

  it('renders request/response section when request data exists', () => {
    const error: any = new Error('Error with request')
    error.mostRecentRequest = {
      query: 'query { test }',
      operationName: 'TestOp',
      operationKind: 'query',
      variables: {},
    }

    render(<DevFatalErrorPage error={error} />)

    expect(screen.getByText(/Request:/)).toBeInTheDocument()
    expect(screen.getByText(/TestOp/)).toBeInTheDocument()
  })
})
