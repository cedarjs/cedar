import { afterEach, beforeEach, describe, expect, vi, it } from 'vitest'

import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import { DEFAULT_LOGGER, MAX_BACKOFF_MS } from '../../consts.js'
import * as errors from '../../errors.js'
import type { BaseJob } from '../../types.js'
import type { JobExecutionContext } from '../executionContext.js'
import { getJobExecutionContext } from '../executionContext.js'
import { Executor } from '../Executor.js'
import type { ExecutorOptions } from '../Executor.js'

import { MockAdapter, mockLogger } from './mocks.js'

const loadersMockFns = vi.hoisted(() => {
  return {
    loadJob: vi.fn(),
  }
})

vi.mock('../../loaders.js', () => {
  return {
    loadJob: loadersMockFns.loadJob,
  }
})

describe('constructor', () => {
  const mockAdapter = new MockAdapter()
  const mockJob: BaseJob = {
    id: 1,
    name: 'mockJob',
    path: 'mockJob/mockJob',
    args: [],
    attempts: 0,
  }

  it('saves options', () => {
    const options = { adapter: mockAdapter, job: mockJob }
    const executor = new Executor(options)

    expect(executor.options).toEqual(expect.objectContaining(options))
  })

  it('extracts adapter from options to variable', () => {
    const options = { adapter: mockAdapter, job: mockJob }
    const executor = new Executor(options)

    expect(executor.adapter).toEqual(mockAdapter)
  })

  it('extracts job from options to variable', () => {
    const options = { adapter: mockAdapter, job: mockJob }
    const executor = new Executor(options)

    expect(executor.job).toEqual(mockJob)
  })

  it('extracts logger from options to variable', () => {
    const options = {
      adapter: mockAdapter,
      job: mockJob,
      logger: mockLogger,
    }
    const executor = new Executor(options)

    expect(executor.logger).toEqual(mockLogger)
  })

  it('defaults logger if not provided', () => {
    const options = { adapter: mockAdapter, job: mockJob }
    const executor = new Executor(options)

    expect(executor.logger).toEqual(DEFAULT_LOGGER)
  })

  it('throws AdapterRequiredError if adapter is not provided', () => {
    const options = { job: mockJob }

    // @ts-expect-error testing error case
    expect(() => new Executor(options)).toThrow(errors.AdapterRequiredError)
  })

  it('throws JobRequiredError if job is not provided', () => {
    const options = { adapter: mockAdapter }

    // @ts-expect-error testing error case
    expect(() => new Executor(options)).toThrow(errors.JobRequiredError)
  })
})

describe('perform', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('invokes the `perform` method on the job class', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(),
    }

    const options = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await executor.perform()

    expect(mockJob.perform).toHaveBeenCalledWith('foo')
  })

  it('invokes the `success` method on the adapter when job successful', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(),
    }
    const options = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    // spy on the success function of the adapter
    const adapterSpy = vi.spyOn(mockAdapter, 'success')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await expect(executor.perform()).resolves.toBe(true)

    expect(adapterSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: true,
    })
  })

  it('keeps the job around after successful job if instructed to do so', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      deleteSuccessfulJobs: false,
    }
    const executor = new Executor(options)

    // spy on the success function of the adapter
    const adapterSpy = vi.spyOn(mockAdapter, 'success')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await executor.perform()

    expect(adapterSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: false,
    })
  })

  it('invokes the `error` method on the adapter when job fails', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    // spy on the error function of the adapter
    const adapterSpy = vi.spyOn(mockAdapter, 'error')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const date = new Date(2025, 6, 7, 9, 50)
    vi.setSystemTime(date)

    await executor.perform()

    expect(adapterSpy).toHaveBeenCalledWith({
      job: options.job,
      runAt: date,
      error: mockError,
    })
  })

  it('passes the correct runAt time to the `error` method on the adapter when job fails', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 2,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    // spy on the error function of the adapter
    const adapterSpy = vi.spyOn(mockAdapter, 'error')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const date = new Date(2025, 6, 7, 9, 50)
    vi.setSystemTime(date)

    await executor.perform()

    expect(adapterSpy).toHaveBeenCalledWith({
      job: options.job,
      runAt: new Date(date.getTime() + 16_000),
      error: mockError,
    })
  })

  it('invokes the `failure` method on the adapter when job fails >= maxAttempts times', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 5,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxAttempts: 5,
      deleteFailedJobs: true,
    }
    const executor = new Executor(options)

    // spy on the error function of the adapter
    const adapterErrorSpy = vi.spyOn(mockAdapter, 'error')
    const adapterFailureSpy = vi.spyOn(mockAdapter, 'failure')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const date = new Date(2025, 6, 7, 10, 50)
    vi.setSystemTime(date)

    await expect(executor.perform()).resolves.toBe(true)

    expect(adapterErrorSpy).toHaveBeenCalledWith({
      job: options.job,
      runAt: new Date(date.getTime() + 625_000),
      error: mockError,
    })

    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: true,
    })
  })

  it('records the error and fails a job with a huge number of attempts', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 3649,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxAttempts: 24,
    }
    const executor = new Executor(options)

    const adapterErrorSpy = vi.spyOn(mockAdapter, 'error')
    const adapterFailureSpy = vi.spyOn(mockAdapter, 'failure')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const date = new Date(2025, 6, 7, 10, 50)
    vi.setSystemTime(date)

    await expect(executor.perform()).resolves.toBe(true)

    expect(adapterErrorSpy).toHaveBeenCalledWith({
      job: options.job,
      runAt: new Date(date.getTime() + MAX_BACKOFF_MS),
      error: mockError,
    })
    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: false,
    })
  })

  it('schedules a retry at most MAX_BACKOFF_MS in the future', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 2000,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxAttempts: 5000,
    }
    const executor = new Executor(options)

    const adapterErrorSpy = vi.spyOn(mockAdapter, 'error')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const date = new Date(2025, 6, 7, 10, 50)
    vi.setSystemTime(date)

    await executor.perform()

    expect(adapterErrorSpy).toHaveBeenCalledWith({
      job: options.job,
      runAt: new Date(date.getTime() + MAX_BACKOFF_MS),
      error: mockError,
    })
  })

  it('logs, instead of throwing, when the adapter fails to record an error', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const adapterError = new Error('mock database error')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 1,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    vi.spyOn(mockAdapter, 'error').mockRejectedValue(adapterError)
    const loggerErrorSpy = vi.spyOn(mockLogger, 'error')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await expect(executor.perform()).resolves.toBe(false)

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not record the error for job 1'),
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('mock database error'),
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(adapterError.stack)
  })

  it('still fails a job at maxAttempts when the adapter fails to record its error', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 24,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    vi.spyOn(mockAdapter, 'error').mockRejectedValue(
      new Error('mock database error'),
    )
    const adapterFailureSpy = vi.spyOn(mockAdapter, 'failure')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await expect(executor.perform()).resolves.toBe(false)

    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: false,
    })
  })

  it('logs, instead of throwing, when the adapter fails to mark a job as failed', async () => {
    const mockAdapter = new MockAdapter()
    const mockError = new Error('mock error in the job perform method')
    const adapterError = new Error('mock database error')
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 24,

      perform: vi.fn(() => {
        throw mockError
      }),
    }
    const options: ExecutorOptions = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    vi.spyOn(mockAdapter, 'failure').mockRejectedValue(adapterError)
    const loggerErrorSpy = vi.spyOn(mockLogger, 'error')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await expect(executor.perform()).resolves.toBe(false)

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not record the error for job 1'),
    )
  })

  it('makes an execution context with an abort signal available to the job', async () => {
    const mockAdapter = new MockAdapter()
    let context: JobExecutionContext | undefined
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(() => {
        context = getJobExecutionContext()
      }),
    }
    const executor = new Executor({
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    })

    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await executor.perform()

    expect(context?.job).toEqual(mockJob)
    expect(context?.signal).toBeInstanceOf(AbortSignal)
    expect(context?.signal.aborted).toEqual(false)
  })

  it('fails a job that runs longer than `maxRuntime` and aborts its signal', async () => {
    const mockAdapter = new MockAdapter()
    let context: JobExecutionContext | undefined
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(() => {
        context = getJobExecutionContext()
        // a job that never finishes
        return new Promise<void>(() => {})
      }),
    }
    const executor = new Executor({
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxRuntime: 10,
      deleteFailedJobs: true,
    })

    const adapterErrorSpy = vi.spyOn(mockAdapter, 'error')
    const adapterFailureSpy = vi.spyOn(mockAdapter, 'failure')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const performPromise = executor.perform()
    await vi.advanceTimersByTimeAsync(10_000)
    await performPromise

    // Timed out jobs are failed right away – they should not be retried
    // while the previous attempt might still be running. The job is failed
    // with a single `failure()` call (never `error()`, which would unlock the
    // job before it's marked as failed) that also records the timeout error
    expect(adapterErrorSpy).not.toHaveBeenCalled()
    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: mockJob,
      deleteJob: true,
      error: expect.any(errors.JobTimeoutError),
    })
    expect(context?.signal.aborted).toEqual(true)
  })

  it('logs a warning when a non-recurring job times out', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 1,

      perform: vi.fn(() => new Promise<void>(() => {})),
    }
    const executor = new Executor({
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxRuntime: 10,
    })

    const loggerWarnSpy = vi.spyOn(mockLogger, 'warn')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const performPromise = executor.perform()
    await vi.advanceTimersByTimeAsync(10_000)
    await performPromise

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      mockJob,
      '[CedarJS Jobs] Failed job 1 (TestJob/TestJob:TestJob): exceeded max ' +
        'runtime (10 seconds)',
    )
  })

  it('logs an error that the schedule stopped when a recurring job times out', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 1,
      cron: '*/10 * * * *',

      perform: vi.fn(() => new Promise<void>(() => {})),
    }
    const executor = new Executor({
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxRuntime: 10,
    })

    const adapterFailureSpy = vi.spyOn(mockAdapter, 'failure')
    const loggerErrorSpy = vi.spyOn(mockLogger, 'error')
    const loggerWarnSpy = vi.spyOn(mockLogger, 'warn')
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const performPromise = executor.perform()
    await vi.advanceTimersByTimeAsync(10_000)
    await performPromise

    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: mockJob,
      deleteJob: false,
      error: expect.any(errors.JobTimeoutError),
    })
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      mockJob,
      '[CedarJS Jobs] Failed job 1 (TestJob/TestJob:TestJob): exceeded max ' +
        "runtime (10 seconds). Its recurring schedule (cron: '*/10 * * * *') " +
        'has stopped and the job will not run again. To restart it, ' +
        'schedule the job again with ' +
        "`later(job, args, { cron: '*/10 * * * *' })`",
    )
    expect(loggerWarnSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('exceeded max runtime'),
    )
  })

  it('does not time out a job that completes before `maxRuntime`', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,

      perform: vi.fn(),
    }
    const executor = new Executor({
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
      maxRuntime: 10,
    })

    const adapterErrorSpy = vi.spyOn(mockAdapter, 'error')
    const adapterSuccessSpy = vi.spyOn(mockAdapter, 'success')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    await executor.perform()
    // advance past `maxRuntime` to prove the timeout was cleaned up
    await vi.advanceTimersByTimeAsync(20_000)

    expect(adapterSuccessSpy).toHaveBeenCalled()
    expect(adapterErrorSpy).not.toHaveBeenCalled()
  })

  it('reschedules cron jobs', async () => {
    const mockAdapter = new MockAdapter()
    const mockJob = {
      id: 1,
      name: 'TestJob',
      path: 'TestJob/TestJob',
      args: ['foo'],
      attempts: 0,
      cron: '0 10 * * *',

      perform: vi.fn(() => {}),
    }
    const options = {
      adapter: mockAdapter,
      logger: mockLogger,
      job: mockJob,
    }
    const executor = new Executor(options)

    // spy on the success function of the adapter
    const adapterSpy = vi.spyOn(mockAdapter, 'success')
    // mock the `loadJob` loader to return the job mock
    loadersMockFns.loadJob.mockImplementation(() => mockJob)

    const date = new Date(2025, 6, 7, 13, 50)
    vi.setSystemTime(date)

    await executor.perform()

    expect(mockJob.perform).toHaveBeenCalled()
    expect(adapterSpy).toHaveBeenCalledWith({
      job: options.job,
      // 0 10 * * * = Every day at 10:00 AM
      runAt: new Date(2025, 6, 8, 10, 0),
      deleteJob: false,
    })
  })
})

describe('recurring (cron) jobs with the PrismaAdapter', () => {
  interface JobRow {
    id: number
    attempts: number
    runAt: Date | null
    failedAt: Date | null
    lockedAt: Date | null
    lockedBy: string | null
    lastError: string | null
  }

  interface RowWhere {
    id: number
    failedAt: null
    attempts: number
  }

  const maxAttempts = 5
  const cron = '*/10 * * * *'
  let row: JobRow
  let shouldFail: boolean
  let adapter: PrismaAdapter

  const rowMatches = (where: RowWhere) =>
    row.id === where.id &&
    row.failedAt === where.failedAt &&
    row.attempts === where.attempts

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 6, 7, 10, 0))

    row = {
      id: 1,
      attempts: 0,
      runAt: new Date(),
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    }
    shouldFail = false

    // A minimal in-memory stand-in for a Prisma client with a single
    // BackgroundJob row, applying the adapter's guarded writes to that row
    const db = {
      _activeProvider: 'sqlite',
      backgroundJob: {
        updateMany: vi.fn(
          ({ where, data }: { where: RowWhere; data: Partial<JobRow> }) => {
            if (!rowMatches(where)) {
              return { count: 0 }
            }

            Object.assign(row, data)

            return { count: 1 }
          },
        ),
        deleteMany: vi.fn(() => ({ count: 0 })),
        create: vi.fn(),
        delete: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    }

    adapter = new PrismaAdapter({ db, logger: mockLogger })

    loadersMockFns.loadJob.mockImplementation(() => ({
      perform: () => {
        if (shouldFail) {
          throw new Error('mock error in a cron run')
        }
      },
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  // Claims the job the way `PrismaAdapter.find()` does (locking it and
  // incrementing `attempts`), then runs it
  const runOnce = async () => {
    row.attempts += 1
    row.lockedAt = new Date()
    row.lockedBy = 'worker'

    const job = {
      id: row.id,
      name: 'CronJob',
      path: 'CronJob/CronJob',
      args: [],
      attempts: row.attempts,
      cron,
    }

    await new Executor({
      adapter,
      logger: mockLogger,
      job,
      maxAttempts,
    }).perform()
  }

  it('keeps running after more than maxAttempts successful runs', async () => {
    for (let i = 0; i < maxAttempts * 3; i++) {
      await runOnce()

      expect(row.attempts).toEqual(0)
      expect(row.failedAt).toBeNull()
      expect(row.runAt).not.toBeNull()
    }
  })

  it('backs off based on consecutive failures after many successful runs', async () => {
    for (let i = 0; i < maxAttempts * 3; i++) {
      await runOnce()
    }

    shouldFail = true
    const now = new Date()
    await runOnce()

    expect(row.failedAt).toBeNull()
    expect(row.attempts).toEqual(1)
    // 1 ** 4 seconds
    expect(row.runAt).toEqual(new Date(now.getTime() + 1_000))

    await runOnce()

    expect(row.failedAt).toBeNull()
    expect(row.attempts).toEqual(2)
    // 2 ** 4 seconds
    expect(row.runAt).toEqual(new Date(now.getTime() + 16_000))

    // A successful retry resumes the schedule with a clean slate
    shouldFail = false
    await runOnce()

    expect(row.attempts).toEqual(0)
    expect(row.lastError).toBeNull()
    expect(row.runAt).toEqual(new Date(2025, 6, 7, 10, 10))
  })

  it('fails permanently after maxAttempts consecutive failures and logs that the schedule stopped', async () => {
    await runOnce()
    await runOnce()

    const loggerErrorSpy = vi.spyOn(mockLogger, 'error')
    const loggerWarnSpy = vi.spyOn(mockLogger, 'warn')

    shouldFail = true

    for (let i = 1; i < maxAttempts; i++) {
      await runOnce()

      expect(row.failedAt).toBeNull()
      expect(row.attempts).toEqual(i)
    }

    expect(loggerErrorSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('recurring schedule'),
    )

    await runOnce()

    expect(row.failedAt).not.toBeNull()
    expect(row.runAt).toBeNull()
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, cron }),
      expect.stringContaining(
        'reached max attempts (5). Its recurring schedule ' +
          "(cron: '*/10 * * * *') has stopped",
      ),
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("later(job, args, { cron: '*/10 * * * *' })"),
    )
    expect(loggerWarnSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('reached max attempts'),
    )
  })
})

describe('backoffMilliseconds()', () => {
  it('returns the number of milliseconds to wait for the next run', () => {
    const mockAdapter = new MockAdapter()
    const mockJob: BaseJob = {
      id: 1,
      name: 'mockJob',
      path: 'mockJob/mockJob',
      args: [],
      attempts: 0,
    }
    const options = { adapter: mockAdapter, job: mockJob }

    expect(new Executor(options).backoffMilliseconds(0)).toEqual(0)
    expect(new Executor(options).backoffMilliseconds(1)).toEqual(1_000)
    expect(new Executor(options).backoffMilliseconds(2)).toEqual(16_000)
    expect(new Executor(options).backoffMilliseconds(3)).toEqual(81_000)
    expect(new Executor(options).backoffMilliseconds(20)).toEqual(160_000_000)
    expect(new Executor(options).backoffMilliseconds(23)).toEqual(279_841_000)
    expect(new Executor(options).backoffMilliseconds(27)).toEqual(531_441_000)
    expect(new Executor(options).backoffMilliseconds(28)).toEqual(
      MAX_BACKOFF_MS,
    )
    expect(new Executor(options).backoffMilliseconds(2000)).toEqual(
      MAX_BACKOFF_MS,
    )
  })

  it('always returns a delay that produces a valid Date', () => {
    const mockAdapter = new MockAdapter()
    const mockJob: BaseJob = {
      id: 1,
      name: 'mockJob',
      path: 'mockJob/mockJob',
      args: [],
      attempts: 0,
    }
    const executor = new Executor({ adapter: mockAdapter, job: mockJob })

    for (const attempts of [1715, 3649, 100_000, Number.MAX_SAFE_INTEGER]) {
      const runAt = new Date(
        Date.now() + executor.backoffMilliseconds(attempts),
      )

      expect(Number.isNaN(runAt.getTime())).toBe(false)
    }
  })
})
