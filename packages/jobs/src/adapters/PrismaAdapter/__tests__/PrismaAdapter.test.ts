import { describe, expect, vi, it, beforeEach, afterEach } from 'vitest'

import {
  DEFAULT_MODEL_NAME,
  MAX_RUNTIME_GRACE_PERIOD,
} from '../../../consts.js'
import { mockLogger } from '../../../core/__tests__/mocks.js'
import * as errors from '../errors.js'
import { PrismaAdapter } from '../PrismaAdapter.js'

vi.useFakeTimers().setSystemTime(new Date('2024-01-01'))

type MockPrismaDb = {
  _activeProvider: string
  backgroundJob: {
    create: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  [key: string]: unknown
}

let mockDb: MockPrismaDb

beforeEach(() => {
  // Setting up a mock generated PrismaClient instance
  mockDb = {
    _activeProvider: 'sqlite',
    backgroundJob: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  }
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('constructor', () => {
  it('defaults this.model name', () => {
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })

    expect(adapter.model).toEqual(DEFAULT_MODEL_NAME)
  })

  it('can manually set this.model', () => {
    mockDb.job = {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    }

    const adapter = new PrismaAdapter({
      db: mockDb,
      // 'job' is the camelCase accessor key for a Prisma model named 'Job'
      model: 'job',
      logger: mockLogger,
    })

    expect(adapter.model).toEqual('job')
  })

  it('throws an error with a model name that does not exist', () => {
    expect(
      () =>
        new PrismaAdapter({ db: mockDb, model: 'fooBar', logger: mockLogger }),
    ).toThrow(errors.ModelNameError)
  })

  it('sets this.accessor to the correct Prisma accessor', () => {
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })

    expect(adapter.accessor).toEqual(mockDb.backgroundJob)
  })

  it('sets this.provider based on the active provider', () => {
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })

    expect(adapter.provider).toEqual('sqlite')
  })
})

describe('schedule()', () => {
  it('creates a job in the DB with required data', async () => {
    const createSpy = vi
      .spyOn(mockDb.backgroundJob, 'create')
      .mockReturnValue({ id: 1 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.schedule({
      name: 'RedwoodJob',
      path: 'RedwoodJob/RedwoodJob',
      args: ['foo', 'bar'],
      queue: 'default',
      priority: 50,
      runAt: new Date(),
    })

    expect(createSpy).toHaveBeenCalledWith({
      data: {
        handler: JSON.stringify({
          name: 'RedwoodJob',
          path: 'RedwoodJob/RedwoodJob',
          args: ['foo', 'bar'],
        }),
        priority: 50,
        queue: 'default',
        runAt: new Date(),
      },
    })
  })

  it('returns the created job', async () => {
    // a newly created row has null lock/error fields
    const mockRow = {
      id: 7,
      attempts: 0,
      handler: JSON.stringify({
        name: 'RedwoodJob',
        path: 'RedwoodJob/RedwoodJob',
        args: ['foo', 'bar'],
      }),
      queue: 'default',
      priority: 50,
      runAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      failedAt: null,
    }
    vi.spyOn(mockDb.backgroundJob, 'create').mockReturnValue(mockRow)
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })

    const job = await adapter.schedule({
      name: 'RedwoodJob',
      path: 'RedwoodJob/RedwoodJob',
      args: ['foo', 'bar'],
      queue: 'default',
      priority: 50,
      runAt: new Date(),
    })

    expect(job).toEqual({
      ...mockRow,
      name: 'RedwoodJob',
      path: 'RedwoodJob/RedwoodJob',
      args: ['foo', 'bar'],
    })
  })
})

describe('find()', () => {
  it('returns undefined if no job found', async () => {
    vi.spyOn(mockDb.backgroundJob, 'findFirst').mockReturnValue(null)
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    const job = await adapter.find({
      processName: 'test',
      maxRuntime: 1000,
      queues: ['foobar'],
    })

    expect(job).toBeUndefined()
  })

  it('returns a job if found', async () => {
    const mockJob = {
      id: 1,
      handler: JSON.stringify({
        name: 'TestJob',
        path: 'TestJob/TestJob',
        args: [],
      }),
    }
    vi.spyOn(mockDb.backgroundJob, 'findFirst').mockReturnValue(mockJob)
    vi.spyOn(mockDb.backgroundJob, 'updateMany').mockReturnValue({ count: 1 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    const job = await adapter.find({
      processName: 'test',
      maxRuntime: 1000,
      queues: ['default'],
    })

    expect(job).toEqual({
      ...mockJob,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: [],
    })
  })

  it('increments the `attempts` count on the found job', async () => {
    const mockJob = {
      id: 1,
      handler: JSON.stringify({
        name: 'TestJob',
        path: 'TestJob/TestJob',
        args: [],
      }),
      attempts: 0,
    }
    vi.spyOn(mockDb.backgroundJob, 'findFirst').mockReturnValue(mockJob)
    const updateSpy = vi
      .spyOn(mockDb.backgroundJob, 'updateMany')
      .mockReturnValue({ count: 1 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.find({
      processName: 'test',
      maxRuntime: 1000,
      queues: ['default'],
    })

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 1 }),
      }),
    )
  })

  it('locks the job for the current process', async () => {
    const mockJob = {
      id: 1,
      attempts: 0,
      handler: JSON.stringify({
        name: 'TestJob',
        path: 'TestJob/TestJob',
        args: [],
      }),
    }
    vi.spyOn(mockDb.backgroundJob, 'findFirst').mockReturnValue(mockJob)
    const updateSpy = vi
      .spyOn(mockDb.backgroundJob, 'updateMany')
      .mockReturnValue({ count: 1 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.find({
      processName: 'test-process',
      maxRuntime: 1000,
      queues: ['default'],
    })

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedBy: 'test-process' }),
      }),
    )
  })

  it('locks the job with a current timestamp', async () => {
    const mockJob = {
      id: 1,
      attempts: 0,
      handler: JSON.stringify({
        name: 'TestJob',
        path: 'TestJob/TestJob',
        args: [],
      }),
    }
    vi.spyOn(mockDb.backgroundJob, 'findFirst').mockReturnValue(mockJob)
    const updateSpy = vi
      .spyOn(mockDb.backgroundJob, 'updateMany')
      .mockReturnValue({ count: 1 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.find({
      processName: 'test-process',
      maxRuntime: 1000,
      queues: ['default'],
    })

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedAt: new Date() }),
      }),
    )
  })

  it('only considers a lock stale after `maxRuntime` seconds have passed', async () => {
    const findFirstSpy = vi
      .spyOn(mockDb.backgroundJob, 'findFirst')
      .mockReturnValue(null)
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.find({
      processName: 'test',
      maxRuntime: 1000,
      queues: ['*'],
    })

    const where = findFirstSpy.mock.calls[0][0].where
    const lockCondition = where.AND[0].OR[0].AND[1].OR[1]

    // a lock is stale if it was taken more than `maxRuntime` seconds (plus a
    // grace period that gives the locking worker time to enforce its own
    // timeout) ago
    expect(lockCondition).toEqual({
      lockedAt: {
        lt: new Date(Date.now() - (1000 + MAX_RUNTIME_GRACE_PERIOD) * 1000),
      },
    })
  })
})

const mockPrismaJob = {
  id: 1,
  handler: '',
  attempts: 10,
  runAt: new Date(),
  cron: null,
  lockedAt: new Date(),
  lockedBy: 'test-process',
  lastError: null,
  failedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  name: 'TestJob',
  path: 'TestJob/TestJob',
  args: [],
}

describe('success()', () => {
  it('deletes the job from the DB if option set', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'deleteMany')
    const adapter = new PrismaAdapter({
      db: mockDb,
      logger: mockLogger,
    })
    await adapter.success({
      job: mockPrismaJob,
      runAt: new Date(),
      deleteJob: true,
    })

    // guarded on `failedAt: null` so a job that was cancelled while running
    // is not deleted when the in-flight attempt completes
    expect(spy).toHaveBeenCalledWith({
      where: { id: 1, failedAt: null, attempts: 10 },
    })
  })

  it('updates the job if option not set', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({
      db: mockDb,
      logger: mockLogger,
    })
    const runAt = new Date()

    await adapter.success({
      job: mockPrismaJob,
      runAt,
      deleteJob: false,
    })

    expect(spy).toHaveBeenCalledWith({
      where: { id: mockPrismaJob.id, failedAt: null, attempts: 10 },
      data: {
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        runAt,
      },
    })
  })
})

describe('error()', () => {
  it('updates the job by id', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.error({
      job: mockPrismaJob,
      runAt: new Date(),
      error: new Error('test error'),
    })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, failedAt: null, attempts: 10 },
      }),
    )
  })

  it('clears the lock fields', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.error({
      job: mockPrismaJob,
      runAt: new Date(),
      error: new Error('test error'),
    })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedAt: null, lockedBy: null }),
      }),
    )
  })

  it('reschedules the job at a designated backoff time', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    const runAt = new Date(new Date().getTime() + 1000 * 10 ** 4)
    await adapter.error({
      job: mockPrismaJob,
      runAt,
      error: new Error('test error'),
    })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runAt,
        }),
      }),
    )
  })

  it('records the error', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.error({
      job: mockPrismaJob,
      runAt: new Date(),
      error: new Error('test error'),
    })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: expect.stringContaining('test error'),
        }),
      }),
    )
  })
})

describe('failure()', () => {
  it('marks the job as failed if max attempts reached', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.failure({ job: mockPrismaJob, deleteJob: false })

    expect(spy).toHaveBeenCalledWith({
      where: { id: 1, failedAt: null, attempts: 10 },
      data: {
        failedAt: new Date(),
        runAt: null,
      },
    })
  })

  it('records the error when failing a job directly (timeout)', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'updateMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.failure({
      job: mockPrismaJob,
      deleteJob: false,
      error: new Error('timeout error'),
    })

    expect(spy).toHaveBeenCalledWith({
      where: { id: 1, failedAt: null, attempts: 10 },
      data: {
        failedAt: new Date(),
        runAt: null,
        lastError: expect.stringContaining('timeout error'),
      },
    })
  })

  it('deletes the job if option is set', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'deleteMany')
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.failure({ job: mockPrismaJob, deleteJob: true })

    expect(spy).toHaveBeenCalledWith({
      where: { id: 1, failedAt: null, attempts: 10 },
    })
  })
})

describe('cancel()', () => {
  it('marks the job as permanently failed', async () => {
    const spy = vi
      .spyOn(mockDb.backgroundJob, 'updateMany')
      .mockReturnValue({ count: 1 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })

    const result = await adapter.cancel({ jobId: 123 })

    // The `failedAt`/`runAt` conditions ensure only active jobs can be
    // cancelled: a completed job that's kept in the database (with
    // `deleteSuccessfulJobs: false`) has `failedAt: null` but also
    // `runAt: null`, and must not be marked as cancelled
    expect(spy).toHaveBeenCalledWith({
      where: { id: 123, failedAt: null, runAt: { not: null } },
      data: {
        failedAt: new Date(),
        lastError: 'Job cancelled by user',
        runAt: null,
      },
    })
    expect(result).toEqual(true)
  })

  it('returns false when there is no active job with the given id', async () => {
    // no rows match the conditions: the job doesn't exist, already
    // completed, or already failed
    vi.spyOn(mockDb.backgroundJob, 'updateMany').mockReturnValue({ count: 0 })
    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })

    const result = await adapter.cancel({ jobId: 123 })

    expect(result).toEqual(false)
  })
})

describe('clear()', () => {
  it('deletes all jobs from the DB', async () => {
    const spy = vi.spyOn(mockDb.backgroundJob, 'deleteMany')

    const adapter = new PrismaAdapter({ db: mockDb, logger: mockLogger })
    await adapter.clear()

    expect(spy).toHaveBeenCalledOnce()
  })
})
