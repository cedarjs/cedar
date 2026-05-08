import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CedarHandler, CedarRequestContext } from '@cedarjs/api/runtime'
import { buildCedarContext } from '@cedarjs/api/runtime'

import { createCedarFetchable } from '../udFetchable.js'

vi.mock('@cedarjs/api/runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    buildCedarContext: vi.fn().mockImplementation(actual.buildCedarContext),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createCedarFetchable', () => {
  describe('wraps a CedarHandler', () => {
    it('calls buildCedarContext and the handler, and returns the handler Response', async () => {
      let capturedCtx: CedarRequestContext | undefined

      const handler: CedarHandler = async (_req, ctx) => {
        capturedCtx = ctx
        return new Response('ok', { status: 200 })
      }

      const fetchable = createCedarFetchable(handler)
      const request = new Request('http://localhost/test')

      const response = await fetchable.fetch(request)

      expect(buildCedarContext).toHaveBeenCalledWith(request)
      expect(capturedCtx).toBeDefined()
      expect(response.status).toBe(200)
    })

    it('returns the Response from the handler', async () => {
      const handler: CedarHandler = async () => {
        return new Response('hello world', {
          status: 201,
          headers: { 'x-custom': 'value' },
        })
      }

      const fetchable = createCedarFetchable(handler)
      const response = await fetchable.fetch(
        new Request('http://localhost/test'),
      )

      expect(response.status).toBe(201)
      expect(response.headers.get('x-custom')).toBe('value')
      expect(await response.text()).toBe('hello world')
    })
  })

  describe('passes the correct context to the handler', () => {
    it('passes query params from the URL', async () => {
      let capturedCtx: CedarRequestContext | undefined

      const handler: CedarHandler = async (_req, ctx) => {
        capturedCtx = ctx
        return new Response('ok')
      }

      const fetchable = createCedarFetchable(handler)
      await fetchable.fetch(
        new Request('http://localhost/test?name=cedar&version=1'),
      )

      expect(capturedCtx?.query.get('name')).toBe('cedar')
      expect(capturedCtx?.query.get('version')).toBe('1')
    })

    it('passes cookies from request headers', async () => {
      let capturedCtx: CedarRequestContext | undefined

      const handler: CedarHandler = async (_req, ctx) => {
        capturedCtx = ctx
        return new Response('ok')
      }

      const fetchable = createCedarFetchable(handler)
      await fetchable.fetch(
        new Request('http://localhost/test', {
          headers: { cookie: 'session=abc123; theme=dark' },
        }),
      )

      expect(capturedCtx?.cookies.get('session')).toBe('abc123')
      expect(capturedCtx?.cookies.get('theme')).toBe('dark')
    })

    it('has empty params by default (no route params injected)', async () => {
      let capturedCtx: CedarRequestContext | undefined

      const handler: CedarHandler = async (_req, ctx) => {
        capturedCtx = ctx
        return new Response('ok')
      }

      const fetchable = createCedarFetchable(handler)
      await fetchable.fetch(new Request('http://localhost/test'))

      expect(capturedCtx?.params).toEqual({})
    })
  })
})
