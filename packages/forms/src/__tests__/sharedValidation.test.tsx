import React from 'react'

import {
  screen,
  render,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'

import { Form, TextField, NumberField, Submit } from '../index'

describe('Form fields with a shared validation object', () => {
  afterEach(() => {
    cleanup()
  })

  it('coerces each field by its own type when validation is shared', async () => {
    const mockFn = vi.fn()
    const shared = { required: true }

    render(
      <Form onSubmit={mockFn}>
        <TextField name="title" defaultValue="hi" validation={shared} />
        <NumberField name="count" defaultValue="42" validation={shared} />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(mockFn).toHaveBeenCalledTimes(1))
    expect(mockFn).toBeCalledWith(
      {
        title: 'hi',
        count: 42, // i.e. NOT "42"
      },
      expect.anything(),
    )
  })

  it('does not mutate the caller-supplied validation object', async () => {
    const mockFn = vi.fn()
    const shared: Record<string, unknown> = {
      required: true,
      valueAsJSON: true,
    }

    render(
      <Form onSubmit={mockFn}>
        <TextField name="title" defaultValue="hi" validation={shared} />
        <NumberField name="count" defaultValue="42" validation={shared} />
        <Submit>Save</Submit>
      </Form>,
    )

    expect(shared.setValueAs).toBeUndefined()
    expect(shared.valueAsJSON).toBe(true)
  })

  it('does not throw when the validation object is frozen', () => {
    const frozen = Object.freeze({ required: true })

    expect(() =>
      render(
        <Form onSubmit={() => {}}>
          <TextField name="title" defaultValue="hi" validation={frozen} />
          <NumberField name="count" defaultValue="42" validation={frozen} />
          <Submit>Save</Submit>
        </Form>,
      ),
    ).not.toThrow()
  })
})
