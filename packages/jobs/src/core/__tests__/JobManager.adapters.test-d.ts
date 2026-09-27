import { describe, it, expectTypeOf } from 'vitest'

import type {
  FindArgs,
  SchedulePayload,
} from '../../adapters/BaseAdapter/BaseAdapter.js'
import { BaseAdapter } from '../../adapters/BaseAdapter/BaseAdapter.js'
import type { PrismaJob } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import type { Adapters, BasicLogger, PossibleBaseJob } from '../../types.js'
import { JobManager } from '../JobManager.js'

/**
 * The parts of a generated PrismaClient that the PrismaAdapter uses
 */
interface MockPrismaClient {
  backgroundJob: {
    findFirst: (args: Record<string, unknown>) => Promise<unknown>
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>
    delete: (args: Record<string, unknown>) => Promise<unknown>
    update: (args: Record<string, unknown>) => Promise<unknown>
    create: (args: Record<string, unknown>) => Promise<unknown>
    deleteMany: (args?: Record<string, unknown>) => Promise<unknown>
  }
}

declare const db: MockPrismaClient
declare const logger: BasicLogger

class CustomAdapter extends BaseAdapter {
  schedule(_payload: SchedulePayload): Promise<string> {
    return Promise.resolve('custom-job-id')
  }

  find(_args: FindArgs): PossibleBaseJob {
    return undefined
  }

  success() {}
  error() {}
  failure() {}
  clear() {}
}

describe('JobManager adapters', () => {
  it('accepts a PrismaAdapter set up like `yarn cedar setup jobs` does', () => {
    const jobs = new JobManager({
      adapters: {
        prisma: new PrismaAdapter({ db, logger }),
      },
      queues: ['default'] as const,
      logger,
      workers: [
        {
          adapter: 'prisma',
          logger,
          queue: '*',
          count: 1,
          maxAttempts: 24,
          maxRuntime: 14_400,
          deleteFailedJobs: false,
          sleepDelay: 5,
        },
      ],
    })

    const later = jobs.createScheduler({ adapter: 'prisma' })
    const job = jobs.createJob({ queue: 'default', perform: () => {} })

    expectTypeOf(later(job)).toEqualTypeOf<Promise<PrismaJob>>()
  })

  it('accepts a custom adapter with its own schedule() return type', () => {
    const jobs = new JobManager({
      adapters: {
        custom: new CustomAdapter({ logger }),
      },
      queues: ['default'] as const,
      logger,
      workers: [],
    })

    const later = jobs.createScheduler({ adapter: 'custom' })
    const job = jobs.createJob({ queue: 'default', perform: () => {} })

    expectTypeOf(later(job)).toEqualTypeOf<Promise<string>>()
  })

  it('accepts any concrete adapter in the Adapters map', () => {
    expectTypeOf<{
      prisma: PrismaAdapter<MockPrismaClient>
      custom: CustomAdapter
    }>().toExtend<Adapters>()
  })
})
