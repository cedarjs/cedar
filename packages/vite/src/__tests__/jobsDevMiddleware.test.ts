import { afterEach, describe, expect, it, vi } from 'vitest'

import { JobNotFoundError } from '@cedarjs/jobs'
import * as jobsModule from '@cedarjs/jobs'

import { startJobsDevWorkers } from '../jobsDevMiddleware.js'

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: {
      jobsConfig: '/mocked/project/api/src/lib/jobs.ts',
      jobs: '/mocked/project/api/src/jobs',
    },
  }),
}))

function makeFakeWorker(processName: string) {
  const worker: any = {
    processName,
    forever: true,
    run: vi.fn(async () => {
      while (worker.forever) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    }),
  }
  return worker
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeViteServer(mod: Record<string, unknown>) {
  return {
    ssrLoadModule: vi.fn().mockResolvedValue(mod),
  } as any
}

describe('startJobsDevWorkers', () => {
  afterEach(() => {
    jobsModule.setJobLoaderOverrides(undefined)
    vi.restoreAllMocks()
  })

  it('returns null and clears overrides when the project has no jobs config', async () => {
    const setOverridesSpy = vi.spyOn(jobsModule, 'setJobLoaderOverrides')
    // No `jobs` export on the loaded module -> JobsLibNotFoundError
    const viteServer = makeViteServer({})

    const pool = await startJobsDevWorkers(viteServer)

    expect(pool).toBeNull()
    // Last call clears the override that was set at the start of the function
    expect(setOverridesSpy).toHaveBeenLastCalledWith(undefined)
  })

  it('returns null when jobs are configured but no workers are defined', async () => {
    const jobsManager = {
      workers: [],
      logger: makeLogger(),
      createWorker: vi.fn(),
    }
    const viteServer = makeViteServer({ jobs: jobsManager })

    const pool = await startJobsDevWorkers(viteServer)

    expect(pool).toBeNull()
    expect(jobsManager.createWorker).not.toHaveBeenCalled()
  })

  it('starts one worker per configured count and stops them gracefully', async () => {
    const createdWorkers: ReturnType<typeof makeFakeWorker>[] = []
    const jobsManager = {
      workers: [
        { adapter: 'prisma', queue: 'default', count: 2 },
        { adapter: 'prisma', queue: ['critical'] },
      ],
      logger: makeLogger(),
      createWorker: vi.fn(({ processName }: { processName: string }) => {
        const worker = makeFakeWorker(processName)
        createdWorkers.push(worker)
        return worker
      }),
    }
    const viteServer = makeViteServer({ jobs: jobsManager })

    const pool = await startJobsDevWorkers(viteServer)

    expect(pool).not.toBeNull()
    expect(jobsManager.createWorker).toHaveBeenCalledTimes(3)
    expect(createdWorkers.map((w) => w.processName)).toEqual([
      'ud-jobs.default.0',
      'ud-jobs.default.1',
      'ud-jobs.critical.0',
    ])
    createdWorkers.forEach((w) => expect(w.run).toHaveBeenCalledTimes(1))

    await pool!.stop()

    expect(createdWorkers.every((w) => w.forever === false)).toBe(true)
  })

  it('wires loadJobsManager/loadJob overrides through the vite server', async () => {
    const fakeJob = { perform: vi.fn() }
    const jobsManager = {
      workers: [{ adapter: 'prisma', queue: 'default', count: 1 }],
      logger: makeLogger(),
      createWorker: vi.fn(({ processName }: { processName: string }) =>
        makeFakeWorker(processName),
      ),
    }
    const viteServer = {
      ssrLoadModule: vi.fn((url: string) => {
        if (url.includes('lib/jobs.ts')) {
          return Promise.resolve({ jobs: jobsManager })
        }
        if (url.includes('MyJob/MyJob')) {
          return Promise.resolve({ MyJob: fakeJob })
        }
        return Promise.resolve({})
      }),
    } as any
    const setOverridesSpy = vi.spyOn(jobsModule, 'setJobLoaderOverrides')

    const pool = await startJobsDevWorkers(viteServer)
    expect(pool).not.toBeNull()

    const overrides = setOverridesSpy.mock.calls[0][0]!

    const loaded = await overrides.loadJob({
      name: 'MyJob',
      path: 'MyJob/MyJob',
    })
    expect(loaded).toBe(fakeJob)
    expect(viteServer.ssrLoadModule).toHaveBeenCalledWith(
      expect.stringContaining('api/src/jobs/MyJob/MyJob'),
    )

    await expect(
      overrides.loadJob({ name: 'MissingJob', path: 'MissingJob/MissingJob' }),
    ).rejects.toThrow(JobNotFoundError)

    await pool!.stop()
  })
})
