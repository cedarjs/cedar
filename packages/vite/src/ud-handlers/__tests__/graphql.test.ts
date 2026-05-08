import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

import { createGraphQLHandler } from '../graphql.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

vi.mock('@cedarjs/graphql-server', () => ({
  createGraphQLYoga: vi.fn(async () => ({
    yoga: {
      handle: vi.fn(async () => new Response('OK', { status: 200 })),
    },
  })),
}))

vi.mock('@cedarjs/api/runtime', () => ({
  buildCedarContext: vi.fn(async () => ({ mock: 'context' })),
  requestToLegacyEvent: vi.fn(async () => ({ mock: 'event' })),
}))

describe('createGraphQLHandler', () => {
  it('lazily initializes yoga and handles a request', async () => {
    const fixturePath = path.join(__dirname, '__fixtures__/graphql-module.js')
    const handler = createGraphQLHandler({ distPath: fixturePath })
    const request = new Request('http://localhost/graphql')
    const response = await handler.fetch(request)
    expect(response.status).toBe(200)
  })
})
