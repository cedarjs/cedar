import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CedarJSJobsError } from '../errors.js'
import {
  jobsFromModules,
  loadAllJobs,
  setJobLoaderOverrides,
} from '../loaders.js'

const paths = vi.hoisted(() => ({ distJobs: '' }))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({ api: { distJobs: paths.distJobs } }),
}))

/** A built job module, as `api/dist/jobs` has them */
const jobModule = (name: string) =>
  `export const ${name} = {
    queue: 'default',
    schedules: [{ cron: '0 * * * *' }],
    perform: async () => {},
    name: '${name}',
    path: '${name}/${name}',
  }
  export const helper = () => {}
`

const writeFile = (file: string, content: string) => {
  const fullPath = path.join(paths.distJobs, file)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content)
}

beforeEach(() => {
  paths.distJobs = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-jobs-'))
})

afterEach(() => {
  fs.rmSync(paths.distJobs, { recursive: true, force: true })
  setJobLoaderOverrides(undefined)
})

describe('loadAllJobs', () => {
  it('imports every job module and returns the jobs they export', async () => {
    writeFile('ReportJob/ReportJob.js', jobModule('ReportJob'))
    writeFile('nested/CleanupJob/CleanupJob.js', jobModule('CleanupJob'))

    const jobs = await loadAllJobs()

    expect(jobs.map((job) => job.name).sort()).toEqual([
      'CleanupJob',
      'ReportJob',
    ])
  })

  it('returns a job re-exported from another module once', async () => {
    writeFile('ReportJob/ReportJob.js', jobModule('ReportJob'))
    writeFile('index.js', "export * from './ReportJob/ReportJob.js'")

    expect(await loadAllJobs()).toHaveLength(1)
  })

  it('skips test, scenario and other non-JS files', async () => {
    writeFile('ReportJob/ReportJob.js', jobModule('ReportJob'))
    writeFile('ReportJob/ReportJob.test.js', 'throw new Error("a test")')
    writeFile('ReportJob/ReportJob.scenarios.js', 'throw new Error("data")')
    writeFile('ReportJob/ReportJob.js.map', '{}')
    writeFile('ReportJob/__tests__/helper.js', 'throw new Error("a helper")')

    expect(await loadAllJobs()).toHaveLength(1)
  })

  it('returns no jobs when there is no jobs directory', async () => {
    paths.distJobs = path.join(paths.distJobs, 'missing')

    expect(await loadAllJobs()).toEqual([])
  })

  it('throws when a module fails to import', async () => {
    writeFile('ReportJob/ReportJob.js', jobModule('ReportJob'))
    writeFile('BrokenJob/BrokenJob.js', 'throw new Error("Broken job")')

    await expect(loadAllJobs()).rejects.toThrow('Broken job')
  })

  it('uses the loadAllJobs override when one is set', async () => {
    const override = vi.fn().mockResolvedValue([])
    setJobLoaderOverrides({
      loadJobsManager: vi.fn(),
      loadJob: vi.fn(),
      loadAllJobs: override,
    })

    await loadAllJobs()

    expect(override).toHaveBeenCalledOnce()
  })

  it("throws when the overrides can't load all jobs", async () => {
    setJobLoaderOverrides({ loadJobsManager: vi.fn(), loadJob: vi.fn() })

    await expect(loadAllJobs()).rejects.toThrow(CedarJSJobsError)
  })
})

describe('jobsFromModules', () => {
  it('keeps only exports that are built jobs', () => {
    const job = {
      queue: 'default',
      perform: () => {},
      name: 'ReportJob',
      path: 'ReportJob/ReportJob',
    }
    const notBuilt = { queue: 'default', perform: () => {} }

    expect(
      jobsFromModules([{ job, notBuilt, value: 1, nothing: null }, { job }]),
    ).toEqual([job])
  })
})
