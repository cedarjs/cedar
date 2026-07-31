import { afterEach, describe, it, expect, vi } from 'vitest'

import { requestToLegacyEvent } from '../runtime.js'
import {
  readRequestBody,
  removeNulls,
  requestToBaseEvent,
} from '../transforms.js'

const BODY = JSON.stringify({ query: '{ __typename }' })

const postRequest = () =>
  new Request('http://localhost:8911/graphql', {
    method: 'POST',
    body: BODY,
  })

describe('request body threading', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reads the body while it is still readable', async () => {
    await expect(readRequestBody(postRequest())).resolves.toEqual(BODY)
  })

  it('returns undefined rather than throwing once the body is consumed', async () => {
    const request = postRequest()
    await request.text()

    await expect(readRequestBody(request)).resolves.toBeUndefined()
  })

  it('uses the passed body after the request has been consumed', async () => {
    const request = postRequest()
    await request.text()

    const event = await requestToBaseEvent(request, BODY)

    expect(event.body).toEqual(BODY)
  })

  it('reads from the request when no body is passed and it is untouched', async () => {
    const event = await requestToBaseEvent(postRequest())

    expect(event.body).toEqual(BODY)
  })

  // The degradation path: a consumed body that nobody threaded through. Better
  // to build an event with no body than to take the whole request down
  it('falls back to a null body when consumed and nothing was passed', async () => {
    const request = postRequest()
    await request.text()

    const event = await requestToBaseEvent(request)

    expect(event.body).toBeNull()
  })

  it('warns in development when it falls back to a null body', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = postRequest()
    await request.text()
    await requestToBaseEvent(request)

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatch(/already been read/)
  })

  it('does not warn outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = postRequest()
    await request.text()
    await requestToBaseEvent(request)

    expect(warn).not.toHaveBeenCalled()
  })

  it('treats an empty body as a null body', async () => {
    const request = new Request('http://localhost:8911/health', {
      method: 'GET',
    })

    const event = await requestToBaseEvent(request, '')

    expect(event.body).toBeNull()
  })

  // Legacy handlers read `event.body`, so this is the path where losing it
  // actually changes what a user's code sees
  it('gives legacy handlers the body carried on the context', async () => {
    const request = postRequest()
    await request.text()

    const event = await requestToLegacyEvent(request, {
      params: {},
      query: new URLSearchParams(),
      cookies: new Map(),
      body: BODY,
    })

    expect(event.body).toEqual(BODY)
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
