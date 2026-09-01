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
  it('Changes nulls to undefined', () => {
    const input = {
      a: null,
      b: 'b',
      c: {
        d: null, // nested null
        e: 3,
        f: {
          g: null, // deeply nested null
          h: [null, null], // array of nulls is also transformed
          i: [1, 2, null, 4],
        },
      },
      myDate: new Date('2020-01-01'),
    }

    const result = removeNulls(input)

    expect(result).toEqual({
      a: undefined,
      b: 'b',
      c: {
        d: undefined,
        e: 3,
        f: {
          g: undefined,
          h: [undefined, undefined],
          i: [1, 2, undefined, 4],
        },
      },
      myDate: new Date('2020-01-01'),
    })
  })
})
