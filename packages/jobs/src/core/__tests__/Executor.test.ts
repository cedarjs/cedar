import { afterEach, beforeEach, describe, expect, vi, it } from 'vitest'

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

    await executor.perform()

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

    await executor.perform()

    expect(adapterErrorSpy).not.toHaveBeenCalled()
    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: true,
      error: mockError,
    })
  })

  it('fails a job with a huge number of attempts without scheduling a retry', async () => {
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

    await expect(executor.perform()).resolves.toBeUndefined()

    expect(adapterErrorSpy).not.toHaveBeenCalled()
    expect(adapterFailureSpy).toHaveBeenCalledWith({
      job: options.job,
      deleteJob: false,
      error: mockError,
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

    await expect(executor.perform()).resolves.toBeUndefined()

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not record the error for job 1'),
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('mock database error'),
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(adapterError.stack)
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

    await expect(executor.perform()).resolves.toBeUndefined()

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
