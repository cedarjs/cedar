import { hostname } from 'node:os'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MockAdapter, mockLogger } from '../../core/__tests__/mocks.js'
import { JobManager } from '../../core/JobManager.js'
import { Worker } from '../../core/Worker.js'
import { getWorker, lockName, processName } from '../cedar-jobs-worker.js'

vi.mock('@cedarjs/cli-helpers/loadEnvFiles', () => {
  return {
    loadEnvFiles: () => {},
  }
})

const mocks = vi.hoisted(() => {
  return {
    loadJobsManager: vi.fn(),
    loadAllJobs: vi.fn(),
  }
})

vi.mock('../../loaders.js', () => {
  return {
    loadJobsManager: mocks.loadJobsManager,
    loadAllJobs: mocks.loadAllJobs,
  }
})

describe('processName', () => {
  it('sets the process title for a single queue', () => {
    const title = processName({ id: 1, queues: 'default' })

    expect(title).toEqual('cedar-jobs-worker.default.1')
  })

  it('sets the process title for an array of queues', () => {
    const title = processName({ id: 1, queues: ['default', 'email'] })

    expect(title).toEqual('cedar-jobs-worker.default-email.1')
  })
})

describe('lockName', () => {
  it('is the process name plus the host and process id', () => {
    const name = lockName({ id: 1, queues: ['default', 'email'] })

    expect(name).toEqual(
      `cedar-jobs-worker.default-email.1 host:${hostname()} pid:${process.pid}`,
    )
  })
})

describe('getWorker', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.loadAllJobs.mockResolvedValue([])
  })

  it('returns an instance of Worker', async () => {
    mocks.loadJobsManager.mockImplementation(
      () =>
        new JobManager({
          adapters: {
            test: new MockAdapter(),
          },
          logger: mockLogger,
          queues: ['default'] as const,
          workers: [
            {
              adapter: 'test',
              logger: mockLogger,
              queue: '*',
              count: 1,
            },
          ],
        }),
    )

    const worker = await getWorker({
      index: 0,
      id: 0,
      workoff: false,
      clear: false,
    })

    expect(worker).toBeInstanceOf(Worker)
  })

  it('calls getWorker on the manager with the proper values', async () => {
    const mockAdapter = new MockAdapter()
    mocks.loadJobsManager.mockImplementation(
      () =>
        new JobManager({
          adapters: {
            test: mockAdapter,
          },
          logger: mockLogger,
          queues: ['default'] as const,
          workers: [
            {
              adapter: 'test',
              logger: mockLogger,
              queue: '*',
              count: 1,
            },
          ],
        }),
    )
    const spy = vi.spyOn(JobManager.prototype, 'createWorker')

    await getWorker({
      index: 0,
      id: 0,
      workoff: false,
      clear: false,
    })

    expect(spy).toHaveBeenCalledWith({
      index: 0,
      workoff: false,
      clear: false,
      processName: `cedar-jobs-worker.*.0 host:${hostname()} pid:${process.pid}`,
    })
  })

  describe('syncing declared schedules', () => {
    const managerWithJobs = () =>
      new JobManager({
        adapters: {
          test: new MockAdapter(),
        },
        logger: mockLogger,
        queues: ['default'] as const,
        workers: [
          {
            adapter: 'test',
            logger: mockLogger,
            queue: '*',
            count: 1,
          },
        ],
      })

    it('syncs before a long-running worker starts', async () => {
      const manager = managerWithJobs()
      mocks.loadJobsManager.mockResolvedValue(manager)
      const spy = vi.spyOn(manager, 'syncSchedules').mockResolvedValue({
        created: [],
        updated: [],
        removed: [],
        unchanged: [],
      })

      await getWorker({ index: 0, id: 0, workoff: false, clear: false })

      expect(spy).toHaveBeenCalledOnce()
    })

    it.each([
      ['workoff', { workoff: true, clear: false }],
      ['clear', { workoff: false, clear: true }],
    ])("doesn't sync in %s mode", async (_mode, flags) => {
      const manager = managerWithJobs()
      mocks.loadJobsManager.mockResolvedValue(manager)
      const spy = vi.spyOn(manager, 'syncSchedules')

      await getWorker({ index: 0, id: 0, ...flags })

      expect(spy).not.toHaveBeenCalled()
    })

    it("doesn't start the worker when the sync fails", async () => {
      const manager = managerWithJobs()
      mocks.loadJobsManager.mockResolvedValue(manager)
      vi.spyOn(manager, 'syncSchedules').mockRejectedValue(
        new Error('Sync failed'),
      )
      const spy = vi.spyOn(manager, 'createWorker')

      await expect(
        getWorker({ index: 0, id: 0, workoff: false, clear: false }),
      ).rejects.toThrow('Sync failed')
      expect(spy).not.toHaveBeenCalled()
    })
  })
})
