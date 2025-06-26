import { describe, beforeEach, it, expect, vi } from 'vitest'

import { InMemoryClient } from '../clients/InMemoryClient.js'
import { CacheTimeoutError } from '../errors.js'
import { createCache } from '../index.js'

describe('client.disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('attempts to disconnect on timeout error', async () => {
    const client = new InMemoryClient()
    const { cache } = createCache(client)
    const getSpy = vi.spyOn(client, 'get')
    getSpy.mockImplementation(() => {
      throw new CacheTimeoutError()
    })
    const disconnectSpy = vi.spyOn(client, 'disconnect')

    await cache('test', () => {
      return { bar: 'baz' }
    })

    // returns existing cached value, not the one that was just set
    expect(disconnectSpy).toHaveBeenCalled()
  })
})
