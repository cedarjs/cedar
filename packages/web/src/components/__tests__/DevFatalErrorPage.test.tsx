import React from 'react'

import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { vi, describe, it, expect, afterEach } from 'vitest'

import { DevFatalErrorPage } from '../DevFatalErrorPage.js'

describe('DevFatalErrorPage', () => {
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

    // userEvent.setup() replaces `window.navigator.clipboard` with a stub, so
    // we have to set up the spy *after* calling userEvent.setup() – can't do it
    // in a beforeEach() like we'd normally do
    vi.spyOn(window.navigator.clipboard, 'writeText')

    const error = new Error('Test error message')

    render(<DevFatalErrorPage error={error} />)

    const copyButton = screen.getByRole('button', { name: /Copy All/ })
    await user.click(copyButton)

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('FATAL ERROR REPORT'),
    )
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Test error message'),
    )
  })

  it('shows copy feedback after clicking Copy All', async () => {
    const user = userEvent.setup()

    // userEvent.setup() replaces `window.navigator.clipboard` with a stub, so
    // we have to set up the spy *after* calling userEvent.setup() – can't do it
    // in a beforeEach() like we'd normally do
    vi.spyOn(window.navigator.clipboard, 'writeText')

    const error = new Error('Test error')

    render(<DevFatalErrorPage error={error} />)
    const copyButton = screen.getByRole('button', { name: /Copy All/ })
    await user.click(copyButton)

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('✓ Copied to clipboard')).toBeInTheDocument()
  })

  it('includes request context in clipboard when Copy All is clicked', async () => {
    const user = userEvent.setup()

    // userEvent.setup() replaces `window.navigator.clipboard` with a stub, so
    // we have to set up the spy *after* calling userEvent.setup() – can't do it
    // in a beforeEach() like we'd normally do
    vi.spyOn(window.navigator.clipboard, 'writeText')

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

    expect(window.navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('REQUEST CONTEXT'),
    )
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('GetUser'),
    )
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"id": "123"'),
    )
  })

  it('includes request context in document if available', () => {
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

  it('includes response context in document if available', async () => {
    const error: any = new Error('GraphQL error')
    error.mostRecentResponse = {
      data: { user: { id: '123', name: 'John' } },
      errors: null,
    }

    render(<DevFatalErrorPage error={error} />)

    // The response section should render
    expect(screen.getByText('Response')).toBeInTheDocument()
    expect(screen.getByText(/"id": "123"/)).toBeInTheDocument()
    expect(screen.getByText(/"name": "John"/)).toBeInTheDocument()
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
