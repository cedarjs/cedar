import { describe, it, expect, vi } from 'vitest'

import { createCatchAllHandler } from '../catch-all.js'

describe('createCatchAllHandler', () => {
  it('dispatches to the correct route module', async () => {
    const mod = {
      fetch: async (_request: Request) => new Response('graphql'),
    }

    const handler = createCatchAllHandler({
      routes: [{ path: '/graphql', methods: ['GET', 'POST'], module: mod }],
      apiRootPath: '/',
    })

    const request = new Request('http://localhost/graphql', {
      method: 'POST',
    })
    const response = await handler.fetch(request)
    expect(await response.text()).toBe('graphql')
  })

  it('returns 404 for unmatched routes', async () => {
    const handler = createCatchAllHandler({
      routes: [],
      apiRootPath: '/',
    })

    const request = new Request('http://localhost/unknown', { method: 'GET' })
    const response = await handler.fetch(request)
    expect(response.status).toBe(404)
  })

  it('strips apiRootPath from the request pathname', async () => {
    const mod = {
      fetch: async (_request: Request) => new Response('health'),
    }

    const handler = createCatchAllHandler({
      routes: [{ path: '/health', methods: ['GET'], module: mod }],
      apiRootPath: '/api/',
    })

    const request = new Request('http://localhost/api/health', {
      method: 'GET',
    })
    const response = await handler.fetch(request)
    expect(await response.text()).toBe('health')
  })

  it('returns 500 when a route handler throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = {
      fetch: async (_request: Request) => {
        throw new Error('boom')
      },
    }

    const handler = createCatchAllHandler({
      routes: [{ path: '/fail', methods: ['GET'], module: mod }],
      apiRootPath: '/',
    })

    const request = new Request('http://localhost/fail', { method: 'GET' })
    const response = await handler.fetch(request)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
    expect(consoleSpy).toHaveBeenCalledWith(
      'Unhandled error in fetch handler for',
      '/fail',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})
