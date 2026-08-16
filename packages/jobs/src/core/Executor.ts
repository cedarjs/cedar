// Used by the job runner to execute a job and track success or failure

import { setTimeout, clearTimeout } from 'node:timers'

import { CronExpressionParser } from 'cron-parser'

import type { BaseAdapter } from '../adapters/BaseAdapter/BaseAdapter.js'
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_RUNTIME,
  DEFAULT_DELETE_FAILED_JOBS,
  DEFAULT_DELETE_SUCCESSFUL_JOBS,
  DEFAULT_LOGGER,
} from '../consts.js'
import {
  AdapterRequiredError,
  JobRequiredError,
  JobTimeoutError,
} from '../errors.js'
import { loadJob } from '../loaders.js'
import type { BaseJob, BasicLogger } from '../types.js'

import { executionContext } from './executionContext.js'

export interface ExecutorOptions {
  adapter: BaseAdapter
  job: BaseJob
  logger?: BasicLogger
  /** Defaults to DEFAULT_MAX_ATTEMPTS */
  maxAttempts?: number
  /**
   * The maximum amount of time, in seconds, that the job is allowed to run
   * before it is marked as failed. Defaults to DEFAULT_MAX_RUNTIME
   */
  maxRuntime?: number
  /** Defaults to DEFAULT_DELETE_FAILED_JOBS */
  deleteFailedJobs?: boolean
  /** Defaults to DEFAULT_DELETE_SUCCESSFUL_JOBS */
  deleteSuccessfulJobs?: boolean
}

export const DEFAULTS = {
  logger: DEFAULT_LOGGER,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  maxRuntime: DEFAULT_MAX_RUNTIME,
  deleteFailedJobs: DEFAULT_DELETE_FAILED_JOBS,
  deleteSuccessfulJobs: DEFAULT_DELETE_SUCCESSFUL_JOBS,
}

export class Executor {
  options: Required<ExecutorOptions>
  adapter: ExecutorOptions['adapter']
  logger: NonNullable<ExecutorOptions['logger']>
  job: BaseJob
  maxAttempts: NonNullable<ExecutorOptions['maxAttempts']>
  maxRuntime: NonNullable<ExecutorOptions['maxRuntime']>
  deleteFailedJobs: NonNullable<ExecutorOptions['deleteFailedJobs']>
  deleteSuccessfulJobs: NonNullable<ExecutorOptions['deleteSuccessfulJobs']>

  constructor(options: ExecutorOptions) {
    this.options = { ...DEFAULTS, ...options }

    // validate that everything we need is available
    if (!this.options.adapter) {
      throw new AdapterRequiredError()
    }
    if (!this.options.job) {
      throw new JobRequiredError()
    }

    this.adapter = this.options.adapter
    this.logger = this.options.logger
    this.job = this.options.job
    this.maxAttempts = this.options.maxAttempts
    // `||` (not `??`) so that 0 falls back to the default, matching how the
    // adapters' `find()` treats maxRuntime
    this.maxRuntime = this.options.maxRuntime || DEFAULT_MAX_RUNTIME
    this.deleteFailedJobs = this.options.deleteFailedJobs
    this.deleteSuccessfulJobs = this.options.deleteSuccessfulJobs
  }

  get jobIdentifier() {
    return `${this.job.id} (${this.job.path}:${this.job.name})`
  }

  async perform() {
    this.logger.info(`[CedarJS Jobs] Started job ${this.jobIdentifier}`)

    const abortController = new AbortController()
    let timeoutId: NodeJS.Timeout | undefined
    let performPromise: Promise<void> | undefined

    try {
      // Start the clock before loading the job module: other workers measure
      // staleness of this job's lock from when it was taken, so everything
      // that happens here—including loading the job—has to fit within
      // `maxRuntime`
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new JobTimeoutError(this.jobIdentifier, this.maxRuntime))
        }, this.maxRuntime * 1000)
      })

      performPromise = (async () => {
        const job = await loadJob({ name: this.job.name, path: this.job.path })

        // The execution context makes the abort signal available to the job
        // via `getJobExecutionContext()`
        await executionContext.run(
          { signal: abortController.signal, job: this.job },
          () => job.perform(...this.job.args),
        )
      })()

      await Promise.race([performPromise, timeoutPromise])

      const runAt = this.job.cron
        ? CronExpressionParser.parse(this.job.cron).next().toDate()
        : undefined

      await this.adapter.success({
        job: this.job,
        runAt,
        deleteJob: !runAt && this.deleteSuccessfulJobs,
      })
    } catch (rawError) {
      const error =
        rawError instanceof Error ? rawError : new Error(String(rawError))
      const timedOut = error instanceof JobTimeoutError

      if (timedOut) {
        // Tell the job to stop doing whatever it's doing. The promise itself
        // can't be forcefully killed, so swallow its eventual settlement to
        // avoid an unhandled rejection
        abortController.abort(error)
        performPromise?.catch(() => {})
      }

      const errorMessage = `[CedarJS Jobs] Error in job ${this.jobIdentifier}: ${error.message}`
      this.logger.error(errorMessage)
      this.logger.error(error.stack)

      if (timedOut) {
        // A timed out job is failed immediately instead of being retried: its
        // previous attempt may still be holding on to resources, so silently
        // re-running it could mean two copies of the job running at once.
        // It's failed in a single `failure()` call (rather than `error()`
        // followed by `failure()`) because `error()` unlocks the job, and a
        // two-step write would leave a moment where another worker could
        // claim the job before `failure()` marks it as permanently failed
        this.logger.warn(
          this.job,
          `[CedarJS Jobs] Failed job ${this.jobIdentifier}: exceeded max ` +
            `runtime (${this.maxRuntime} seconds)`,
        )

        await this.adapter.failure({
          job: this.job,
          deleteJob: this.deleteFailedJobs,
          error,
        })
      } else {
        await this.adapter.error({
          job: this.job,
          runAt: new Date(
            new Date().getTime() + this.backoffMilliseconds(this.job.attempts),
          ),
          error,
        })

        if (this.job.attempts >= this.maxAttempts) {
          this.logger.warn(
            this.job,
            `[CedarJS Jobs] Failed job ${this.jobIdentifier}: reached max ` +
              `attempts (${this.maxAttempts})`,
          )

          await this.adapter.failure({
            job: this.job,
            deleteJob: this.deleteFailedJobs,
          })
        }
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  backoffMilliseconds(attempts: number) {
    return 1000 * attempts ** 4
  }
}
