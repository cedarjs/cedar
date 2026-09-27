import { pathToFileURL } from 'node:url'

import { CronExpressionParser } from 'cron-parser'

// TODO(jgmw): Refactor and move this into `@cedarjs/project-config` or similar
export function makeFilePath(path: string) {
  return pathToFileURL(path).href
}

/**
 * Returns the next time after now that the given cron expression matches.
 * Used both when a recurring job is first scheduled and when it's rescheduled
 * after a run, so that every run of the job lines up with its cron schedule.
 */
export function nextCronRunAt(cron: string) {
  return CronExpressionParser.parse(cron).next().toDate()
}
