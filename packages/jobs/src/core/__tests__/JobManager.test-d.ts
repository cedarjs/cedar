import { describe, it, expectTypeOf } from 'vitest'

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

    it('should accept no arguments, but with options', () => {
      expectTypeOf(scheduler(jobWithNoArgs, { wait: 30 })).toEqualTypeOf<
        Promise<boolean>
      >()
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

    it('should accept only one argument', () => {
      expectTypeOf(scheduler(jobWithOptionalArgs, ['1st'])).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should require array even for just one argument', () => {
      // @ts-expect-error - array required
      expectTypeOf(scheduler(jobWithOptionalArgs, '1st')).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should accept empty array', () => {
      expectTypeOf(scheduler(jobWithOptionalArgs, [])).toEqualTypeOf<
        Promise<boolean>
      >()
    })
  })

  describe('scheduler with cron options', () => {
    const job = manager.createJob({
      queue: 'default',
      perform: () => {
        return void 0
      },
    })

    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it('should accept cron as an option', () => {
      expectTypeOf(scheduler(job, [], { cron: '0 0 * * *' })).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should not accept cron with wait option', () => {
      // @ts-expect-error - should not be allowed to pass both cron and wait
      scheduler(job, [], { cron: '0 0 * * *', wait: 30 })
    })

    it('should not accept cron with waitUntil option', () => {
      // @ts-expect-error - should not be allowed to pass both cron and waitUntil
      scheduler(job, [], { cron: '0 0 * * *', waitUntil: new Date() })
    })

    it('should accept wait option without cron', () => {
      expectTypeOf(scheduler(job, [], { wait: 30 })).toEqualTypeOf<
        Promise<boolean>
      >()
    })

    it('should accept waitUntil option without cron', () => {
      expectTypeOf(scheduler(job, [], { waitUntil: new Date() })).toEqualTypeOf<
        Promise<boolean>
      >()
    })
  })

  describe('createJob', () => {
    it('should create job without cron schedule in definition', () => {
      const jobDefinition: JobDefinition<['default'], unknown[]> = {
        queue: 'default',
        perform: () => {},
      }

      const createdJob = manager.createJob(jobDefinition)
      expectTypeOf(createdJob).toHaveProperty('queue')
      expectTypeOf(createdJob).toHaveProperty('perform')
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
