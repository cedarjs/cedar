import { hostname } from 'node:os'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { CronExpressionParser } from 'cron-parser'

// TODO(jgmw): Refactor and move this into `@cedarjs/project-config` or similar
export function makeFilePath(path: string) {
  return pathToFileURL(path).href
}

/**
 * The name a worker locks jobs with (`lockedBy`), built from its process
 * name. A worker takes back any job locked under its own name, so the name
 * has to be unique to this process: the process name alone is the same for
 * the same worker config in every app server, on every host, and two workers
 * sharing it would both run a job, and each one's result would hand the job
 * back to the other to run again.
 *
 * Shared by `cedar-jobs-worker`'s own workers and Unified Dev's in-process
 * ones (`jobsDevMiddleware.ts` in `@cedarjs/vite`), so the format only needs
 * to be tested and changed in one place.
 */
export function lockName(processName: string) {
  return `${processName} host:${hostname()} pid:${process.pid}`
}

/**
 * Returns the next time after now that the given cron expression matches.
 * Used both when a recurring job is first scheduled and when it's rescheduled
 * after a successful run, so that both line up with its cron schedule.
 */
export function nextCronRunAt(cron: string) {
  return CronExpressionParser.parse(cron).next().toDate()
}
