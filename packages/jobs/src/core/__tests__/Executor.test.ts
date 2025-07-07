import { afterEach, beforeEach, describe, expect, vi, it } from 'vitest'

import { DEFAULT_LOGGER } from '../../consts.js'
import * as errors from '../../errors.js'
import type { BaseJob } from '../../types.js'
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
  })
})
