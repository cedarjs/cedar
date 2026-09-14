import { vi, describe, expect, it } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import { createGraphQLServer } from '../createGraphQLServer.js'

vi.mock('@cedarjs/realtime', () => ({
  useCedarRealtime: vi.fn(() => ({ name: 'useCedarRealtime' })),
}))

describe('createGraphQLServer smoke-test', () => {
  it('Should only require required parameters', async () => {
    const { logger, yoga } = await createGraphQLServer({
      loggerConfig: { logger: createLogger({}) },
      sdls: {},
      services: {},
    })

    expect(logger).toBeTruthy()
    expect(yoga).toBeTruthy()
  })

  it('should load the cedar realtime plugin when realtime options are given', async () => {
    const { useCedarRealtime } = await import('@cedarjs/realtime')

    const { logger, yoga } = await createGraphQLServer({
      loggerConfig: { logger: createLogger({}) },
      sdls: {},
      services: {},
      realtime: { subscriptions: {} as any },
    })

    expect(useCedarRealtime).toHaveBeenCalledWith({ subscriptions: {} })
    expect(logger).toBeTruthy()
    expect(yoga).toBeTruthy()
  })
})
