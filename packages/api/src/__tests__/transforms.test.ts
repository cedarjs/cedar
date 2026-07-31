import { afterEach, describe, it, expect, vi } from 'vitest'

import { requestToLegacyEvent } from '../runtime.js'
import {
  captureRequestBody,
  captureRequestBodyByCloning,
  removeNulls,
  requestToBaseEvent,
} from '../transforms.js'

const BODY = JSON.stringify({ query: '{ __typename }' })

const postRequest = () =>
  new Request('http://localhost:8911/graphql', {
    method: 'POST',
    body: BODY,
  })

describe('request body capture', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('keeps the body when captured from a known string', async () => {
    const request = postRequest()
    captureRequestBody(request, BODY)

    // Whatever handles the request consumes the body
    await request.text()

    const event = await requestToBaseEvent(request)

    expect(event.body).toEqual(BODY)
  })

  it('keeps the body when captured by cloning', async () => {
    const request = postRequest()
    await captureRequestBodyByCloning(request)

    await request.text()

    const event = await requestToBaseEvent(request)

    expect(event.body).toEqual(BODY)
  })

  it('reads from the request itself when the body is still untouched', async () => {
    const event = await requestToBaseEvent(postRequest())

    expect(event.body).toEqual(BODY)
  })

  // The degradation path: a consumed body that nobody captured. Better to
  // build an event with no body than to take the whole request down
  it('falls back to a null body when consumed and never captured', async () => {
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
    expect(warn.mock.calls[0][0]).toMatch(/captureRequestBody/)
  })

  it('does not warn outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = postRequest()
    await request.text()
    await requestToBaseEvent(request)

    expect(warn).not.toHaveBeenCalled()
  })

  // Entry points capture unconditionally, so capturing a request that
  // something else already consumed has to be a no-op rather than a throw
  it('does not throw when capturing an already consumed body', async () => {
    const request = postRequest()
    await request.text()

    await expect(captureRequestBodyByCloning(request)).resolves.toBeUndefined()

    const event = await requestToBaseEvent(request)
    expect(event.body).toBeNull()
  })

  it('captures an empty body as a null body', async () => {
    const request = new Request('http://localhost:8911/health', {
      method: 'GET',
    })
    captureRequestBody(request, '')

    const event = await requestToBaseEvent(request)

    expect(event.body).toBeNull()
  })

  // Legacy handlers read `event.body`, so this is the path where losing it
  // actually changes what a user's code sees
  it('gives legacy handlers the captured body after it was consumed', async () => {
    const request = postRequest()
    captureRequestBody(request, BODY)

    await request.text()

    const event = await requestToLegacyEvent(request, {
      params: {},
      query: new URLSearchParams(),
      cookies: new Map(),
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
