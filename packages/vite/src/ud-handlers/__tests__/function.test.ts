import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

import { createFunctionHandler } from '../function.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

vi.mock('@cedarjs/api-server/udFetchable', () => ({
  createCedarFetchable: vi.fn((handler) => ({
    fetch: (request: Request) =>
      handler(request, {
        params: {},
        query: new URLSearchParams(),
        cookies: new Map(),
      }),
  })),
}))

describe('createFunctionHandler', () => {
  it('delegates to the module handleRequest export', async () => {
    const distUrl = path.resolve(__dirname, '__fixtures__/function-module.js')
    const handler = createFunctionHandler({ distUrl })
    const request = new Request('http://localhost/api/test')
    const response = await handler.fetch(request)
    expect(await response.text()).toBe('hello from function')
  })

  it('falls back to a legacy handler export wrapped with wrapLegacyHandler', async () => {
    const distUrl = path.resolve(
      __dirname,
      '__fixtures__/legacy-function-module.js',
    )
    const handler = createFunctionHandler({ distUrl })
    const request = new Request('http://localhost/api/test')
    const response = await handler.fetch(request)
    expect(await response.text()).toBe('hello from legacy handler')
  })

  it('throws if no handler is found', async () => {
    const distUrl = path.resolve(__dirname, '__fixtures__/empty-module.js')
    const handler = createFunctionHandler({ distUrl })
    const request = new Request('http://localhost/api/test')
    await expect(handler.fetch(request)).rejects.toThrow('Handler not found')
  })
})
