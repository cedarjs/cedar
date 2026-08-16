// Gives a running job access to details about its own execution, most
// importantly an AbortSignal that is aborted when the job exceeds the
// worker's `maxRuntime`

import { AsyncLocalStorage } from 'node:async_hooks'

import type { BaseJob } from '../types.js'

export interface JobExecutionContext {
  /**
   * Aborted when the job exceeds the worker's `maxRuntime` (or when the
   * executor otherwise wants the job to stop). Pass this to `fetch()`, child
   * processes, or check `signal.aborted` in long-running loops so the job can
   * actually stop doing work when it times out — Node.js promises themselves
   * cannot be forcefully killed.
   */
  signal: AbortSignal

  /** The job that is currently being executed */
  job: BaseJob
}

export const executionContext = new AsyncLocalStorage<JobExecutionContext>()

/**
 * Returns the execution context for the currently running job, or `undefined`
 * when called outside of a job's `perform()` function.
 *
 * ```ts
 * import { getJobExecutionContext } from '@cedarjs/jobs'
 *
 * export const SampleJob = jobs.createJob({
 *   queue: 'default',
 *   perform: async () => {
 *     const context = getJobExecutionContext()
 *     await fetch('https://example.com', { signal: context?.signal })
 *   },
 * })
 * ```
 */
export function getJobExecutionContext(): JobExecutionContext | undefined {
  return executionContext.getStore()
}
