import { describe, it, expectTypeOf } from 'vitest'

import type { JobDefinition } from '../../types.js'
import type {
  ListedSchedule,
  PausedSchedule,
  ResumedSchedule,
} from '../JobManager.js'
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

    it("should accept correct arguments and return the adapter's schedule() return type", () => {
      expectTypeOf(
        scheduler(jobWithRequiredArgs, [{ foo: 'foo', bar: 645 }], {
          wait: 30,
        }),
      ).toEqualTypeOf<Promise<void>>()
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
      expectTypeOf(scheduler(jobWithNoArgs, [])).toEqualTypeOf<Promise<void>>()
    })

    it('should accept empty array and options', () => {
      expectTypeOf(scheduler(jobWithNoArgs, [], { wait: 30 })).toEqualTypeOf<
        Promise<void>
      >()
    })

    it('should accept undefined as second parameter', () => {
      expectTypeOf(scheduler(jobWithNoArgs, undefined)).toEqualTypeOf<
        Promise<void>
      >()
    })

    it('should accept no arguments at all', () => {
      expectTypeOf(scheduler(jobWithNoArgs)).toEqualTypeOf<Promise<void>>()
    })

    it('should accept no arguments, but with options', () => {
      expectTypeOf(scheduler(jobWithNoArgs, { wait: 30 })).toEqualTypeOf<
        Promise<void>
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
      ).toEqualTypeOf<Promise<void>>()
    })

    it('should accept only one argument', () => {
      expectTypeOf(scheduler(jobWithOptionalArgs, ['1st'])).toEqualTypeOf<
        Promise<void>
      >()
    })

    it('should require array even for just one argument', () => {
      // @ts-expect-error - array required
      expectTypeOf(scheduler(jobWithOptionalArgs, '1st')).toEqualTypeOf<
        Promise<void>
      >()
    })

    it('should accept empty array', () => {
      expectTypeOf(scheduler(jobWithOptionalArgs, [])).toEqualTypeOf<
        Promise<void>
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
        Promise<void>
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
        Promise<void>
      >()
    })

    it('should accept waitUntil option without cron', () => {
      expectTypeOf(scheduler(job, [], { waitUntil: new Date() })).toEqualTypeOf<
        Promise<void>
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

    it('should accept integer priorities from 1 to 100', () => {
      manager.createJob({ queue: 'default', priority: 1, perform: () => {} })
      manager.createJob({ queue: 'default', priority: 50, perform: () => {} })
      manager.createJob({ queue: 'default', priority: 100, perform: () => {} })

      // prettier-ignore
      expectTypeOf<JobDefinition<['default']>['priority']>().toEqualTypeOf<
        | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
        | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
        | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30
        | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40
        | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50
        | 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 | 59 | 60
        | 61 | 62 | 63 | 64 | 65 | 66 | 67 | 68 | 69 | 70
        | 71 | 72 | 73 | 74 | 75 | 76 | 77 | 78 | 79 | 80
        | 81 | 82 | 83 | 84 | 85 | 86 | 87 | 88 | 89 | 90
        | 91 | 92 | 93 | 94 | 95 | 96 | 97 | 98 | 99 | 100
        | undefined
      >()
    })

    it('should reject priorities outside of 1 to 100', () => {
      // @ts-expect-error - priority must be at least 1
      manager.createJob({ queue: 'default', priority: 0, perform: () => {} })
      // @ts-expect-error - priority must be at most 100
      manager.createJob({ queue: 'default', priority: 101, perform: () => {} })
      // @ts-expect-error - priority must be an integer
      manager.createJob({ queue: 'default', priority: 1.5, perform: () => {} })
    })
  })

  describe('scheduler function type', () => {
    const scheduler = manager.createScheduler({ adapter: 'mock' })

    it("should be a function that returns the adapter's schedule() return type", () => {
      expectTypeOf(scheduler).toBeFunction()
      expectTypeOf(scheduler).returns.toEqualTypeOf<Promise<void>>()
    })

    it('should have a cancel function', () => {
      expectTypeOf(scheduler.cancel).toBeFunction()
      expectTypeOf(scheduler.cancel)
        .parameter(0)
        .toEqualTypeOf<string | number>()
      expectTypeOf(scheduler.cancel).returns.toEqualTypeOf<Promise<boolean>>()
    })
  })

  describe('declared schedules', () => {
    it("should type check each schedule's args against perform()", () => {
      manager.createJob({
        queue: 'default',
        schedules: [
          { key: 'day', cron: '*/15 * * * *', args: ['day', 1] },
          { key: 'night', cron: '45 4 * * *', args: ['night', 14] },
        ],
        perform: (_sweep: 'day' | 'night', _days: number) => {},
      })

      manager.createJob({
        queue: 'default',
        // @ts-expect-error - args must match perform()'s parameters
        schedules: [{ cron: '0 * * * *', args: ['week', 1] }],
        perform: (_sweep: 'day' | 'night', _days: number) => {},
      })

      manager.createJob({
        queue: 'default',
        // @ts-expect-error - args are required when perform() takes arguments
        schedules: [{ cron: '0 * * * *' }],
        perform: (_sweep: 'day' | 'night') => {},
      })
    })

    it('should not use the schedules to infer the job arguments', () => {
      const job = manager.createJob({
        queue: 'default',
        schedules: [{ cron: '0 * * * *', args: ['literal'] }],
        perform: (_value: string) => {},
      })

      expectTypeOf(job.perform).parameters.toEqualTypeOf<[string]>()
    })

    it('should make args optional when perform() takes none', () => {
      manager.createJob({
        queue: 'default',
        schedules: [{ cron: '0 * * * *' }],
        perform: () => {},
      })
    })

    it('should only accept adapter names as scheduleAdapter', () => {
      const withScheduleAdapter = new JobManager({
        adapters: { mock: mockAdapter },
        queues: ['default'] as const,
        logger: mockLogger,
        workers: [],
        scheduleAdapter: 'mock',
      })
      expectTypeOf(withScheduleAdapter.scheduleAdapter).toEqualTypeOf<
        'mock' | undefined
      >()

      const withUnknownAdapter = new JobManager({
        adapters: { mock: mockAdapter },
        queues: ['default'] as const,
        logger: mockLogger,
        workers: [],
        // @ts-expect-error - not one of the adapters
        scheduleAdapter: 'prisma',
      })
      expectTypeOf(withUnknownAdapter).toBeObject()
    })
  })

  describe('unique keys', () => {
    const scheduler = manager.createScheduler({ adapter: 'mock' })
    const job = manager.createJob({
      queue: 'default',
      perform: (_id: number) => {},
    })

    it('should accept a key with any timing option', () => {
      scheduler(job, [1], { key: 'job:1' })
      scheduler(job, [1], { key: 'job:1', wait: 30 })
      scheduler(job, [1], { key: 'job:1', waitUntil: new Date() })
      scheduler(job, [1], { key: 'job:1', cron: '0 * * * *' })
    })

    it('should still reject combining timing options', () => {
      // @ts-expect-error - wait and cron are mutually exclusive
      scheduler(job, [1], { key: 'job:1', wait: 30, cron: '0 * * * *' })
    })
  })

  describe('pausing declared schedules', () => {
    const job = manager.createJob({
      queue: 'default',
      schedules: [
        { key: 'day', cron: '*/15 * * * *', args: [1] },
        { key: 'night', cron: '45 4 * * *', args: [14] },
      ],
      perform: (_days: number) => {},
    })

    it('should take a job and an optional schedule key', () => {
      expectTypeOf(manager.pauseSchedule(job, 'night')).toEqualTypeOf<
        Promise<PausedSchedule>
      >()
      expectTypeOf(manager.resumeSchedule(job)).toEqualTypeOf<
        Promise<ResumedSchedule>
      >()
      expectTypeOf(manager.listSchedules()).toEqualTypeOf<
        Promise<ListedSchedule[]>
      >()
    })

    it('should return whether anything changed', () => {
      expectTypeOf<PausedSchedule>().toEqualTypeOf<{
        key: string
        alreadyPaused: boolean
        pausedAt: Date
      }>()
      expectTypeOf<ResumedSchedule>().toEqualTypeOf<{
        key: string
        wasPaused: boolean
        runAt: Date | null
      }>()
    })

    it('should reject what is not a job or a key', () => {
      // @ts-expect-error - the job name is not a job
      void manager.pauseSchedule('ReportJob')
      // @ts-expect-error - the key is a string
      void manager.resumeSchedule(job, 1)
    })
  })
})
