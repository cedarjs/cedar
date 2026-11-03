import React from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { EmptyAsValue, RedwoodRegisterOptions } from '../coercion'
import { setCoercion } from '../coercion'
import {
  DateField,
  DatetimeLocalField,
  Form,
  Submit,
  TextField,
} from '../index'

const emptyCases: {
  emptyAs: EmptyAsValue | undefined
  expected: null | undefined | '' | 0
}[] = [
  { emptyAs: undefined, expected: null },
  { emptyAs: null, expected: null },
  { emptyAs: 'undefined', expected: undefined },
  { emptyAs: '', expected: '' },
  { emptyAs: 0, expected: 0 },
]

describe('DateField coercion in Europe/Berlin', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Berlin')
    // Ensure the regression exercises a non-UTC timezone.
    expect(new Date('2026-03-05T00:00:00').getTimezoneOffset()).toBe(-60)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ['2026-03-05', '2026-03-05T00:00:00.000Z'],
    ['12026-03-05', '+012026-03-05T00:00:00.000Z'],
    ['202627-03-05', '+202627-03-05T00:00:00.000Z'],
    ['0001-03-05', '0001-03-05T00:00:00.000Z'],
    ['0099-03-05', '0099-03-05T00:00:00.000Z'],
    ['0100-03-05', '0100-03-05T00:00:00.000Z'],
    ['0004-02-29', '0004-02-29T00:00:00.000Z'],
    ['275760-09-13', '+275760-09-13T00:00:00.000Z'],
  ])('submits %s as a UTC calendar date', async (value, iso) => {
    const onSubmit = vi.fn<(data: { date: Date }) => void>()

    render(
      <Form onSubmit={onSubmit}>
        <DateField name="date" data-testid="date" />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.change(screen.getByTestId('date'), {
      target: { value },
    })
    expect(screen.getByTestId('date')).toHaveValue(value)
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].date.toISOString()).toBe(iso)
  })

  it('uses UTC date coercion when valueAsDate is explicitly enabled', async () => {
    const onSubmit = vi.fn<(data: { date: Date }) => void>()

    render(
      <Form onSubmit={onSubmit}>
        <DateField
          name="date"
          defaultValue="202627-03-05"
          validation={{ valueAsDate: true }}
        />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].date.toISOString()).toBe(
      '+202627-03-05T00:00:00.000Z',
    )
  })

  it.each(
    emptyCases.flatMap((emptyCase) =>
      [false, true].map((valueAsDate) => ({ ...emptyCase, valueAsDate })),
    ),
  )(
    'preserves emptyAs=$emptyAs with valueAsDate=$valueAsDate',
    async ({ emptyAs, expected, valueAsDate }) => {
      const onSubmit = vi.fn<(data: { date: unknown }) => void>()

      render(
        <Form onSubmit={onSubmit}>
          <DateField
            name="date"
            emptyAs={emptyAs}
            validation={{ valueAsDate }}
          />
          <Submit>Save</Submit>
        </Form>,
      )

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].date).toBe(expected)
    },
  )

  it.each(emptyCases)(
    'coerces a nonempty extended year with emptyAs=$emptyAs',
    async ({ emptyAs }) => {
      const onSubmit = vi.fn<(data: { date: Date }) => void>()

      render(
        <Form onSubmit={onSubmit}>
          <DateField
            name="date"
            defaultValue="202627-03-05"
            emptyAs={emptyAs}
          />
          <Submit>Save</Submit>
        </Form>,
      )

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].date.toISOString()).toBe(
        '+202627-03-05T00:00:00.000Z',
      )
    },
  )

  it.each(['', '202627-03-05'])(
    'lets an explicit setValueAs override date coercion and emptyAs for "%s"',
    async (value) => {
      const onSubmit = vi.fn<(data: { date: string }) => void>()
      const setValueAs = (input: string) => `custom:${input}`
      const validation = Object.freeze({ setValueAs })

      render(
        <Form onSubmit={onSubmit}>
          <DateField
            name="date"
            defaultValue={value}
            emptyAs={null}
            validation={validation}
          />
          <Submit>Save</Submit>
        </Form>,
      )

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].date).toBe(`custom:${value}`)
      expect(validation.setValueAs).toBe(setValueAs)
    },
  )

  it.each([
    ['2026-03-05T12:34', '2026-03-05T11:34:00.000Z'],
    ['2026-07-05T12:34', '2026-07-05T10:34:00.000Z'],
  ])('keeps datetime-local %s in local time', async (value, iso) => {
    const onSubmit = vi.fn<(data: { date: Date }) => void>()

    render(
      <Form onSubmit={onSubmit}>
        <DatetimeLocalField name="date" defaultValue={value} />
        <Submit>Save</Submit>
      </Form>,
    )

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].date.toISOString()).toBe(iso)
  })

  it.each(emptyCases)(
    'preserves datetime-local emptyAs=$emptyAs',
    async ({ emptyAs, expected }) => {
      const onSubmit = vi.fn<(data: { date: unknown }) => void>()

      render(
        <Form onSubmit={onSubmit}>
          <DatetimeLocalField name="date" emptyAs={emptyAs} />
          <Submit>Save</Submit>
        </Form>,
      )

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].date).toBe(expected)
    },
  )

  it.each([
    ['202627-03-05', '+202627-03-04T23:00:00.000Z'],
    ['2026-03-05T12:34', '2026-03-05T11:34:00.000Z'],
    ['2026-03-05T12:34:00+03:00', '2026-03-05T09:34:00.000Z'],
  ])(
    'keeps arbitrary valueAsDate text "%s" parsing unchanged',
    async (value, iso) => {
      const onSubmit = vi.fn<(data: { date: Date }) => void>()

      render(
        <Form onSubmit={onSubmit}>
          <TextField
            name="date"
            defaultValue={value}
            validation={{ valueAsDate: true }}
          />
          <Submit>Save</Submit>
        </Form>,
      )

      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0].date.toISOString()).toBe(iso)
    },
  )

  it.each(
    ['text', 'datetime-local'].flatMap((type) =>
      emptyCases.flatMap(({ emptyAs }) => [
        {
          type,
          emptyAs,
          value: '2026-03-05T12:34',
          iso: '2026-03-05T11:34:00.000Z',
        },
        {
          type,
          emptyAs,
          value: '202627-03-05',
          iso: '+202627-03-04T23:00:00.000Z',
        },
      ]),
    ),
  )(
    'keeps the $type date callback parsing "$value" with emptyAs=$emptyAs',
    ({ type, emptyAs, value, iso }) => {
      const validation: RedwoodRegisterOptions = { valueAsDate: true }
      setCoercion(validation, { type, name: 'date', emptyAs })

      const result: unknown = validation.setValueAs?.(value)
      expect(result).toBeInstanceOf(Date)
      if (!(result instanceof Date)) {
        throw new Error('Expected date coercion to return a Date')
      }
      expect(result.toISOString()).toBe(iso)
      expect(validation.valueAsDate).toBe(true)
    },
  )

  // HTML inputs sanitize malformed dates to empty strings. Exercise raw values
  // through the coercion callback installed by the field registration path.
  it.each([
    'not-a-date',
    ' 2026-03-05',
    '2026-03-05 ',
    '2026-03-05\n',
    '2026-3-05',
    '026-03-05',
    '2026-03-05T00:00:00Z',
    '+202627-03-05',
    '-000001-03-05',
    '0000-03-05',
    '2026-00-05',
    '2026-13-05',
    '2026-03-00',
    '2026-03-32',
    '2026-04-31',
    '2026-02-29',
    '0100-02-29',
    '202627-02-29',
    '275760-09-14',
    '275761-01-01',
    '999999-03-05',
    `${'9'.repeat(400)}-03-05`,
  ])(
    'returns Invalid Date for invalid or unrepresentable date "%s"',
    (value) => {
      const validation: RedwoodRegisterOptions = {}
      setCoercion(validation, { type: 'date', name: 'date' })

      const result: unknown = validation.setValueAs?.(value)
      expect(result).toBeInstanceOf(Date)
      if (!(result instanceof Date)) {
        throw new Error('Expected date coercion to return a Date')
      }
      expect(result.getTime()).toBeNaN()
    },
  )
})
