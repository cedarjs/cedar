import React from 'react'

import {
  screen,
  render,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'

import { Form, TextAreaField, Submit, FieldError } from '../index'

describe('valueAsJSON + validate', () => {
  afterEach(() => {
    cleanup()
  })

  it('blocks submit and shows the user message when a validate function rejects valid JSON', async () => {
    const mockFn = vi.fn()

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{}'}
          validation={{
            valueAsJSON: true,
            validate: (value) =>
              (value && 'theme' in value) || 'theme is required',
          }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('settingsError')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settingsError')).toHaveTextContent(
      'theme is required',
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('submits the parsed object when valid JSON satisfies the validate function', async () => {
    const mockFn = vi.fn()

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{"theme":"dark"}'}
          validation={{
            valueAsJSON: true,
            validate: (value) =>
              (value && 'theme' in value) || 'theme is required',
          }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() => expect(mockFn).toHaveBeenCalled())
    expect(screen.queryByTestId('settingsError')).not.toBeInTheDocument()
    expect(mockFn.mock.calls[0][0]).toEqual({
      settings: { theme: 'dark' },
    })
  })

  it('runs every function in a validate object of named validators', async () => {
    const mockFn = vi.fn()

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{"theme":"dark"}'}
          validation={{
            valueAsJSON: true,
            validate: {
              hasTheme: (value) =>
                (value && 'theme' in value) || 'theme is required',
              hasVersion: (value) =>
                (value && 'version' in value) || 'version is required',
            },
          }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('settingsError')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settingsError')).toHaveTextContent(
      'version is required',
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('lets every named validator pass when all of them are satisfied', async () => {
    const mockFn = vi.fn()

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{"theme":"dark","version":1}'}
          validation={{
            valueAsJSON: true,
            validate: {
              hasTheme: (value) =>
                (value && 'theme' in value) || 'theme is required',
              hasVersion: (value) =>
                (value && 'version' in value) || 'version is required',
            },
          }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() => expect(mockFn).toHaveBeenCalled())
    expect(screen.queryByTestId('settingsError')).not.toBeInTheDocument()
    expect(mockFn.mock.calls[0][0]).toEqual({
      settings: { theme: 'dark', version: 1 },
    })
  })

  it('reports the default JSON error, not the user validator, for unparseable JSON', async () => {
    const mockFn = vi.fn()
    const userValidate = vi.fn(() => 'theme is required')

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{bad-json}'}
          validation={{
            valueAsJSON: true,
            validate: userValidate,
          }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('settingsError')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settingsError')).toHaveTextContent(
      'settings is not valid',
    )
    expect(userValidate).not.toHaveBeenCalled()
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('behaves as it does without a validate prop when valueAsJSON is used on its own', async () => {
    const mockFn = vi.fn()

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{"theme":"dark"}'}
          validation={{ valueAsJSON: true }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() => expect(mockFn).toHaveBeenCalled())
    expect(screen.queryByTestId('settingsError')).not.toBeInTheDocument()
    expect(mockFn.mock.calls[0][0]).toEqual({
      settings: { theme: 'dark' },
    })
  })

  it('still blocks submit on bad JSON when there is no validate prop', async () => {
    const mockFn = vi.fn()

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{bad-json}'}
          validation={{ valueAsJSON: true }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('settingsError')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settingsError')).toHaveTextContent(
      'settings is not valid',
    )
    expect(mockFn).not.toHaveBeenCalled()
  })

  it("never calls user validators with unparseable JSON, also with `criteriaMode: 'all'` and integer-like keys", async () => {
    const mockFn = vi.fn()
    const hasTheme = vi.fn(
      (value: Record<string, unknown>) =>
        'theme' in value || 'theme is required',
    )
    const integerLikeKey = vi.fn(() => 'should not run')

    render(
      <Form onSubmit={mockFn} config={{ criteriaMode: 'all' }}>
        <TextAreaField
          name="settings"
          defaultValue={'{bad-json}'}
          validation={{
            valueAsJSON: true,
            validate: { 0: integerLikeKey, hasTheme },
          }}
        />
        <FieldError
          name="settings"
          render={({ messages }) => (
            <p data-testid="settingsErrors">
              {Object.values(messages ?? {}).join(', ')}
            </p>
          )}
        />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('settingsErrors')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('settingsErrors')).toHaveTextContent(
      /^settings is not valid$/,
    )
    expect(integerLikeKey).not.toHaveBeenCalled()
    expect(hasTheme).not.toHaveBeenCalled()
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('runs a user validator that has the same key as the JSON check', async () => {
    const mockFn = vi.fn()
    const validJSON = vi.fn(() => 'rejected by the user validator')

    render(
      <Form onSubmit={mockFn}>
        <TextAreaField
          name="settings"
          defaultValue={'{"theme":"dark"}'}
          validation={{
            valueAsJSON: true,
            validate: { validJSON },
          }}
        />
        <FieldError name="settings" data-testid="settingsError" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.submit(screen.getByText('Save'))

    await waitFor(() =>
      expect(screen.getByTestId('settingsError')).toHaveTextContent(
        'rejected by the user validator',
      ),
    )
    expect(validJSON).toHaveBeenCalledWith({ theme: 'dark' }, expect.anything())
    expect(mockFn).not.toHaveBeenCalled()
  })
})
