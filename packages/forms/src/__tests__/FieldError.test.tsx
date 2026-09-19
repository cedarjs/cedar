import React from 'react'

import { screen, render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { Form, TextField, Submit, FieldError, useFormContext } from '../index'

const SetRootError = ({ message }: { message?: string }) => {
  const { setError } = useFormContext()

  return (
    <button
      type="button"
      onClick={() => setError('root.server', { type: '500', message })}
    >
      Set root error
    </button>
  )
}

describe('FieldError', () => {
  it('renders a default message for a `validate` object key', async () => {
    render(
      <Form>
        <TextField
          name="username"
          validation={{ validate: { isAvailable: () => false } }}
        />
        <FieldError name="username" data-testid="fieldError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('fieldError')).toHaveTextContent(
        'username is not valid',
      ),
    )
  })

  it('passes the message, including the default one, and type to `render`', async () => {
    render(
      <Form>
        <TextField name="username" validation={{ required: true }} />
        <FieldError
          name="username"
          render={({ message, type }) => (
            <p data-testid="fieldError" data-type={type}>
              {message}
            </p>
          )}
        />
        <Submit>Save</Submit>
      </Form>,
    )

    expect(screen.queryByTestId('fieldError')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('fieldError')).toHaveTextContent(
        'username is required',
      ),
    )
    expect(screen.getByTestId('fieldError').tagName).toEqual('P')
    expect(screen.getByTestId('fieldError')).toHaveAttribute(
      'data-type',
      'required',
    )
  })

  it("passes every failed rule's message to `render` with `criteriaMode: 'all'`", async () => {
    render(
      <Form config={{ criteriaMode: 'all' }}>
        <TextField
          name="password"
          defaultValue="abc"
          validation={{
            minLength: { value: 8, message: 'At least 8 characters' },
            pattern: /\d/,
          }}
        />
        <FieldError
          name="password"
          render={({ messages }) => (
            <ul data-testid="fieldErrors">
              {Object.entries(messages ?? {}).map(([type, message]) => (
                <li key={type}>{message}</li>
              ))}
            </ul>
          )}
        />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('fieldErrors')).toBeInTheDocument(),
    )

    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'At least 8 characters',
      'password is not formatted correctly',
    ])
  })

  it('leaves `messages` undefined without `criteriaMode: "all"`', async () => {
    let receivedMessages: unknown = 'not called'

    render(
      <Form>
        <TextField name="username" validation={{ required: true }} />
        <FieldError
          name="username"
          render={({ messages }) => {
            receivedMessages = messages
            return null
          }}
        />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(receivedMessages).toBeUndefined())
  })

  it('renders the message of a `root` error', async () => {
    render(
      <Form>
        <SetRootError message="The server is on fire" />
        <FieldError name="root.server" data-testid="rootError" />
      </Form>,
    )

    fireEvent.click(screen.getByText('Set root error'))

    await waitFor(() =>
      expect(screen.getByTestId('rootError')).toHaveTextContent(
        /^The server is on fire$/,
      ),
    )
  })

  it("doesn't make up a default message for a `root` error", async () => {
    render(
      <Form>
        <SetRootError />
        <FieldError name="root.server" data-testid="rootError" />
        <FieldError
          name="root.server"
          render={({ type }) => <p data-testid="rootErrorType">{type}</p>}
        />
      </Form>,
    )

    fireEvent.click(screen.getByText('Set root error'))

    await waitFor(() =>
      expect(screen.getByTestId('rootErrorType')).toHaveTextContent('500'),
    )
    expect(screen.queryByTestId('rootError')).not.toBeInTheDocument()
  })
})
