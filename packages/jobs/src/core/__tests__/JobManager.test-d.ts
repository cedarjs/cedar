import { describe, it, expectTypeOf, assertType } from 'vitest'

import type { JobDefinition } from '../../types.js'
import { JobManager } from '../JobManager.js'

import { MockAdapter, mockLogger } from './mocks.js'

describe('JobManager Type Tests', () => {
  const mockAdapter = new MockAdapter()
  const manager = new JobManager({
    adapters: {
      mock: mockAdapter,
    },
    queues: ['default'] as const,
    logger: mockLogger,
    workers: [],
  })

  describe('scheduler with required arguments', () => {
    interface MockJobArgs {
      foo: string
      bar: number
    }

    const jobWithRequiredArgs = manager.createJob({
      queue: 'default',
      perform: ({ foo, bar }: MockJobArgs) => {
        return void (foo + bar)
      },
    })

    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it('should accept correct arguments and return Promise<boolean>', () => {
      expectTypeOf(
        scheduler(jobWithRequiredArgs, [{ foo: 'foo', bar: 645 }], {
          wait: 30,
        }),
      ).toEqualTypeOf<Promise<boolean>>()
    })

    it('should reject undefined when arguments are required', () => {
      expectTypeOf(scheduler).parameter(1).not.toMatchTypeOf<undefined>()
    })

    it('should reject missing arguments when they are required', () => {
      expectTypeOf(scheduler).parameters.not.toMatchTypeOf<
        [typeof jobWithRequiredArgs]
      >()
    })
  })

  describe('scheduler with no arguments required', () => {
    const jobWithNoArgs = manager.createJob({
      queue: 'default',
      perform: () => {
        return void 'no args'
      },
    })

    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it('should accept empty array', () => {
      expectTypeOf(scheduler(jobWithNoArgs, [])).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should accept empty array and options', () => {
      expectTypeOf(scheduler(jobWithNoArgs, [], { wait: 30 })).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should accept undefined as second parameter', () => {
      expectTypeOf(scheduler(jobWithNoArgs, undefined)).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should accept no arguments at all', () => {
      expectTypeOf(scheduler(jobWithNoArgs)).toEqualTypeOf<Promise<boolean>>()
    })
  })

  describe('scheduler with optional arguments', () => {
    const jobWithOptionalArgs = manager.createJob({
      queue: 'default',
      perform: (first?: string, second?: string) => {
        return void (first || '' + second)
      },
    })

    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it('should accept correct arguments', () => {
      expectTypeOf(
        scheduler(jobWithOptionalArgs, ['1st', '2nd']),
      ).toEqualTypeOf<Promise<boolean>>()
    })

    it('should accept empty array', () => {
      expectTypeOf(scheduler(jobWithOptionalArgs, [])).toEqualTypeOf<
        Promise<boolean>
      >()
    })
  })

  describe('scheduler for cron jobs', () => {
    const cronJob = manager.createJob({
      queue: 'default',
      cron: '0 0 * * *',
      perform: () => {
        return void 0
      },
    })

    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it('should accept no arguments', () => {
      expectTypeOf(scheduler(cronJob)).toEqualTypeOf<Promise<boolean>>()
    })

    it('should accept empty array as arguments', () => {
      expectTypeOf(scheduler(cronJob, [])).toEqualTypeOf<Promise<boolean>>()
    })

    it('should not accept options when a cron schedule is defined', () => {
      // @ts-expect-error - should not be allowed to pass options
      assertType(scheduler(cronJob, [], { wait: 30 }))
    })

    it('should accept options if `cron` is undefined', () => {
      const job = manager.createJob({
        queue: 'default',
        cron: undefined,
        perform: () => {
          return void 0
        },
      })

      assertType(scheduler(job, [], { wait: 30 }))
    })

    it('should accept options if `cron` is an empty string', () => {
      const job = manager.createJob({
        queue: 'default',
        cron: '',
        perform: () => {
          return void 0
        },
      })

      assertType(scheduler(job, [], { wait: 30 }))
    })
  })

  describe('createJob', () => {
    it('should preserve cron schedule in job definition', () => {
      const cronJobDefinition: JobDefinition<['default'], unknown[]> = {
        queue: 'default',
        cron: '0 0 * * *',
        perform: () => {},
      }

      const createdCronJob = manager.createJob(cronJobDefinition)
      expectTypeOf(createdCronJob).toHaveProperty('cron')
    })
  })

  describe('scheduler function type', () => {
    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it('should be a function that returns Promise<boolean>', () => {
      expectTypeOf(scheduler).toBeFunction()
      expectTypeOf(scheduler).returns.toEqualTypeOf<Promise<boolean>>()
    })
  })
})
