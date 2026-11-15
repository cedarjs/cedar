import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import { createGraphQLServer } from '../createGraphQLServer.js'
import { createYogaLogger } from '../yogaLogger.js'

vi.mock('@cedarjs/realtime', () => ({
  useCedarRealtime: vi.fn(() => ({ name: 'useCedarRealtime' })),
}))

describe('createYogaLogger', () => {
  let logLevel: string | undefined

  beforeEach(() => {
    logLevel = process.env.LOG_LEVEL
  })

  afterEach(() => {
    if (logLevel === undefined) {
      delete process.env.LOG_LEVEL
    } else {
      process.env.LOG_LEVEL = logLevel
    }
  })

  it.each(['silent', 'fatal'])(
    'serves requests when LOG_LEVEL is %s',
    async (level) => {
      process.env.LOG_LEVEL = level

      const { yoga } = await createGraphQLServer({
        loggerConfig: { logger: createLogger({}) },
        sdls: {},
        services: {},
      })

      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        data: { __typename: 'Query' },
      })
      expect(process.env.LOG_LEVEL).toBe(level)
    },
  )

  it('forwards messages from nested child loggers to the Cedar logger', () => {
    process.env.LOG_LEVEL = 'silent'

    const logger = createLogger({ options: { level: 'info' } })
    const info = vi.spyOn(logger, 'info')

    createYogaLogger(logger)
      .child({ requestId: 'abc' })
      .child('[prefix] ')
      .info('hello')

    expect(info).toHaveBeenCalledOnce()
    expect(JSON.stringify(info.mock.calls[0])).toContain('hello')
    expect(process.env.LOG_LEVEL).toBe('silent')
  })
})
