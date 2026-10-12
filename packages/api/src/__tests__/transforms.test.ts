import { describe, it, expect } from 'vitest'

import { removeNulls, requestToBaseEvent } from '../transforms.js'

describe('requestToBaseEvent', () => {
  it('backfills x-forwarded-proto from the request URL when absent', async () => {
    const request = new Request('https://example.com/graphql', {
      method: 'POST',
    })

    const event = await requestToBaseEvent(request)

    expect(event.headers['x-forwarded-proto']).toEqual('https')
  })

  it('preserves an existing x-forwarded-proto header', async () => {
    const request = new Request('https://internal.example.com/graphql', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'http',
      },
    })

    const event = await requestToBaseEvent(request)

    expect(event.headers['x-forwarded-proto']).toEqual('http')
  })
})

describe('removeNulls utility', () => {
  it('changes top-level nulls to undefined', () => {
    const myDate = new Date('2020-01-01')

    const result = removeNulls({ a: null, b: 'b', c: 0, d: false, myDate })

    expect(result).toStrictEqual({
      a: undefined,
      b: 'b',
      c: 0,
      d: false,
      myDate,
    })
  })

  it('leaves nested values, like Json field values, as they are', () => {
    const meta = { d: null, e: [1, null] }

    const result = removeNulls({ meta, list: [null] })

    expect(result.meta).toBe(meta)
    expect(result.meta).toStrictEqual({ d: null, e: [1, null] })
    expect(result.list).toStrictEqual([null])
  })

  it('changes nulls in an array to undefined', () => {
    const result = removeNulls([1, null, 'x'])

    expect(Array.isArray(result)).toBe(true)
    expect(result).toStrictEqual([1, undefined, 'x'])
  })

  it('returns a copy and leaves the input unchanged', () => {
    const input = { a: null, b: 'b' }

    const result = removeNulls(input)

    expect(result).not.toBe(input)
    expect(input).toStrictEqual({ a: null, b: 'b' })
  })
})
