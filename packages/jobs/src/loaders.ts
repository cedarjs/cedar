import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

import type { JobManager } from './core/JobManager.js'
import {
  CedarJSJobsError,
  JobsLibNotFoundError,
  JobNotFoundError,
} from './errors.js'
import type {
  Adapters,
  BasicLogger,
  Job,
  JobComputedProperties,
  QueueNames,
} from './types.js'
import { makeFilePath } from './util.js'

export interface JobLoaderOverrides {
  loadJobsManager: () => Promise<JobManager<Adapters, QueueNames, BasicLogger>>
  loadJob: (
    computedProperties: JobComputedProperties,
  ) => Promise<Job<QueueNames, unknown[]>>
  /**
   * Imports every job module and returns the jobs they export. Used to find
   * the jobs' declared `schedules`. Without it, `loadAllJobs()` throws while
   * the overrides are set, as an empty list would make the schedule sync
   * remove every stored schedule
   */
  loadAllJobs?: () => Promise<Job<QueueNames, unknown[]>[]>
}

// Allows an alternative loading strategy (e.g. Vite's SSR module runner
// under Unified Dev, where compiled `api/dist` output never exists on disk)
// to be swapped in without changing `Executor`, `JobManager`, or any of the
// `cedar-jobs*` bins, all of which only ever call the `loadJobsManager`/
// `loadJob` functions exported below.
let overrides: JobLoaderOverrides | undefined

export const setJobLoaderOverrides = (
  newOverrides: JobLoaderOverrides | undefined,
) => {
  overrides = newOverrides
}

/**
 * Loads the job manager from the users project
 *
 * @returns JobManager
 */
export const loadJobsManager = async (): Promise<
  JobManager<Adapters, QueueNames, BasicLogger>
> => {
  if (overrides) {
    return overrides.loadJobsManager()
  }

  // Confirm the specific lib/jobs.ts file exists
  const jobsConfigPath = getPaths().api.distJobsConfig
  if (!jobsConfigPath) {
    throw new JobsLibNotFoundError()
  }

  // Import the jobs manager
  const importPath = makeFilePath(jobsConfigPath)
  const { jobs } = await import(importPath)
  if (!jobs) {
    throw new JobsLibNotFoundError()
  }

  return jobs
}

/**
 * Load a specific job implementation from the users project
 */
export const loadJob = async (
  computedProperties: JobComputedProperties,
): Promise<Job<QueueNames, unknown[]>> => {
  if (overrides) {
    return overrides.loadJob(computedProperties)
  }

  const { name: jobName, path: jobPath } = computedProperties

  // Confirm the specific job file exists
  const completeJobPath = path.join(getPaths().api.distJobs, jobPath) + '.js'

  if (!fs.existsSync(completeJobPath)) {
    throw new JobNotFoundError(jobName)
  }

  const importPath = makeFilePath(completeJobPath)
  const jobModule = await import(importPath)

  if (!jobModule[jobName]) {
    throw new JobNotFoundError(jobName)
  }

  return jobModule[jobName]
}

/**
 * Whether `value` is a job created with `createJob()` and given its `name`
 * and `path` by the build
 */
export const isJob = (value: unknown): value is Job<QueueNames, unknown[]> => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<Record<keyof Job<QueueNames>, unknown>>

  return (
    typeof candidate.perform === 'function' &&
    typeof candidate.queue === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string'
  )
}

/**
 * Collects the jobs a set of imported modules export, each job once (a job
 * re-exported from several modules is the same object)
 */
export const jobsFromModules = (modules: Record<string, unknown>[]) => {
  const jobs = new Set<Job<QueueNames, unknown[]>>()

  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (isJob(value)) {
        jobs.add(value)
      }
    }
  }

  return [...jobs]
}

/**
 * Whether a file in the jobs directory is a module that can hold jobs: a
 * script file that isn't a test, scenario, mock or type declaration
 */
export const isJobModuleFile = (file: string) =>
  /\.(c|m)?(j|t)sx?$/.test(file) &&
  !/\.d\.(c|m)?ts$/.test(file) &&
  !/\.(test|spec|scenarios|mock)\.[^.]+$/.test(file) &&
  !/(^|[\\/])__(tests|mocks)__[\\/]/.test(file)

/**
 * Imports every job module from the user's project and returns the jobs
 * they export. A module that fails to import makes this throw, rather than
 * leave that module's jobs out: the schedule sync removes stored schedules
 * that aren't declared, so a job left out would silently lose its schedules
 */
export const loadAllJobs = async (): Promise<Job<QueueNames, unknown[]>[]> => {
  if (overrides) {
    if (!overrides.loadAllJobs) {
      throw new CedarJSJobsError(
        'The job loader overrides do not implement `loadAllJobs()`, so ' +
          "the jobs' declared schedules can't be found",
      )
    }

    return overrides.loadAllJobs()
  }

  const jobsDir = getPaths().api.distJobs

  if (!fs.existsSync(jobsDir)) {
    return []
  }

  const files = fs
    .readdirSync(jobsDir, { recursive: true, encoding: 'utf-8' })
    .filter((file) => file.endsWith('.js') && isJobModuleFile(file))
    .sort()

  const modules: Record<string, unknown>[] = []

  for (const file of files) {
    modules.push(await import(makeFilePath(path.join(jobsDir, file))))
  }

  return jobsFromModules(modules)
}
