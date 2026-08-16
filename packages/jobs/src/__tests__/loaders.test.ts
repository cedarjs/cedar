import { afterEach, describe, expect, it, vi } from 'vitest'

import { JobsLibNotFoundError } from '../errors.js'
import { loadJob, loadJobsManager, setJobLoaderOverrides } from '../loaders.js'

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: {
      distJobsConfig: null,
      distJobs: '/mocked/project/api/dist/jobs',
    },
  }),
}))

describe('setJobLoaderOverrides', () => {
  afterEach(() => {
    // Don't let overrides set by one test leak into the next
    setJobLoaderOverrides(undefined)
  })

  it('loadJobsManager uses the override when one is set', async () => {
    const fakeManager = { workers: [] } as any
    const loadJobsManagerOverride = vi.fn().mockResolvedValue(fakeManager)

    setJobLoaderOverrides({
      loadJobsManager: loadJobsManagerOverride,
      loadJob: vi.fn(),
    })

    const result = await loadJobsManager()

    expect(result).toBe(fakeManager)
    expect(loadJobsManagerOverride).toHaveBeenCalledTimes(1)
  })

  it('loadJob uses the override when one is set, forwarding the computed properties', async () => {
    const fakeJob = { perform: vi.fn() } as any
    const loadJobOverride = vi.fn().mockResolvedValue(fakeJob)

    setJobLoaderOverrides({
      loadJobsManager: vi.fn(),
      loadJob: loadJobOverride,
    })

    const computedProperties = { name: 'MyJob', path: 'MyJob/MyJob' }
    const result = await loadJob(computedProperties)

    expect(result).toBe(fakeJob)
    expect(loadJobOverride).toHaveBeenCalledWith(computedProperties)
  })

  it('falls back to the default dist-file behaviour once overrides are cleared', async () => {
    setJobLoaderOverrides({
      loadJobsManager: vi.fn().mockResolvedValue({ workers: [] }),
      loadJob: vi.fn(),
    })
    setJobLoaderOverrides(undefined)

    // With no override and a `null` distJobsConfig (per the mocked
    // getPaths()), the default implementation must throw rather than call
    // the (now-cleared) override.
    await expect(loadJobsManager()).rejects.toThrow(JobsLibNotFoundError)
  })
})
