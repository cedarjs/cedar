import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

import type { JobManager } from './core/JobManager.js'
import { JobsLibNotFoundError, JobNotFoundError } from './errors.js'
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
