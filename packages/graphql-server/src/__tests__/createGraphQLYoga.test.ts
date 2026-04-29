import { vi, describe, expect, it } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import { createGraphQLYoga } from '../createGraphQLYoga.js'

vi.mock('@cedarjs/realtime', () => ({
  useCedarRealtime: vi.fn(() => ({ name: 'useCedarRealtime' })),
}))

describe('createGraphQLYoga smoke-test', () => {
  it('Should only require required parameters', async () => {
    const { logger, yoga } = await createGraphQLYoga({
      loggerConfig: { logger: createLogger({}) },
      sdls: {},
      services: {},
    })

    expect(logger).toBeTruthy()
    expect(yoga).toBeTruthy()
  })

  it('should load the cedar realtime plugin when realtime options are given', async () => {
    const { useCedarRealtime } = await import('@cedarjs/realtime')

    const { logger, yoga } = await createGraphQLYoga({
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
