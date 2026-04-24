import { describe, expect, it } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import { createGraphQLYoga } from '../createGraphQLYoga.js'

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
})
