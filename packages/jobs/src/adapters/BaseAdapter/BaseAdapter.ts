import { DEFAULT_LOGGER } from '../../consts.js'
import type { BaseJob, BasicLogger, PossibleBaseJob } from '../../types.js'

// Arguments sent to an adapter to schedule a job
export interface SchedulePayload {
  name: string
  path: string
  args: unknown[]
  cron?: string | undefined
  runAt: Date
  queue: string
  priority: number
}

export interface FindArgs {
  processName: string
  maxRuntime: number
  queues: string[]
}

export interface BaseAdapterOptions {
  logger?: BasicLogger
}

export interface SuccessOptions<TJob extends BaseJob = BaseJob> {
  job: TJob
  /**
   * When set, the job is a recurring (cron) job and has to run again at this
   * time. The adapter must store it as the job's new `runAt` and reset the
   * job's attempt count to 0
   */
  runAt: Date | undefined
  deleteJob?: boolean
}

export interface ErrorOptions<TJob extends BaseJob = BaseJob> {
  job: TJob
  runAt: Date
  error: Error
}

export interface FailureOptions<TJob extends BaseJob = BaseJob> {
  job: TJob
  deleteJob?: boolean
  /**
   * The error of the attempt that failed the job (it exceeded `maxRuntime`,
   * or it was the `maxAttempts`th attempt). There is no preceding `error()`
   * call for that attempt, so the adapter records the error in the same
   * write that marks the job as failed
   */
  error?: Error
}

export interface CancelOptions {
  /** The id of the job to cancel, as returned by `schedule()` */
  jobId: string | number
}

export interface PauseOptions {
  /** The id of the job to pause, as returned by `schedule()` */
  jobId: string | number
}

export interface PauseResult {
  /** `true` when the job was paused already, and nothing changed */
  alreadyPaused: boolean
  /** When the job was paused */
  pausedAt: Date
}

export interface ResumeOptions {
  /** The id of the job to resume, as returned by `schedule()` */
  jobId: string | number
}

export interface ResumeResult {
  /** `false` when the job wasn't paused, and nothing changed */
  wasPaused: boolean
  /** When the job runs next */
  runAt: Date | null
}

export interface ListJobsOptions {
  /** The most jobs to return, the ones that run next first */
  limit: number
}

/** A job waiting to run, running or paused, as `list()` returns it */
export interface ListedJob {
  id: string | number
  name: string
  queue: string
  /** Set for a recurring job */
  cron: string | null
  /** When the job runs next (or would, if it weren't paused) */
  runAt: Date | null
  /** When the job was paused, or `null` when it isn't */
  pausedAt: Date | null
  /** Whether a worker is running the job right now */
  running: boolean
  attempts: number
}

/**
 * Base class for all job adapters. Provides a common interface for scheduling
 * jobs. At a minimum, you must implement the `schedule` method in your adapter.
 *
 * Any object passed to the constructor is saved in `this.options` and should
 * be used to configure your custom adapter. If `options.logger` is included
 * you can access it via `this.logger`
 */
export abstract class BaseAdapter<
  TOptions extends BaseAdapterOptions = BaseAdapterOptions,
  TScheduleReturn = unknown,
> {
  options: TOptions
  logger: NonNullable<TOptions['logger']>

  constructor(options: TOptions) {
    this.options = options
    this.logger = options?.logger ?? DEFAULT_LOGGER
  }

  // It's up to the subclass to decide what `schedule()` returns. The job engine
  // itself doesn't care about the return value, but the user may want to do
  // something with the result depending on the adapter type. `TScheduleReturn`
  // defaults to `unknown` so that every concrete adapter, whatever its
  // `schedule()` returns, is assignable to a plain `BaseAdapter` (which is what
  // the `Adapters` map and the job engine internals use).

  abstract schedule(payload: SchedulePayload): TScheduleReturn

  /**
   * Find a single job that's eligible to run with the given args
   */
  abstract find(args: FindArgs): PossibleBaseJob | Promise<PossibleBaseJob>

  /**
   * Called when a job has successfully completed.
   *
   * When `options.runAt` is set the job is a recurring (cron) job that has to
   * run again at that time. The adapter must then store the new `runAt` and
   * reset the job's attempt count to 0, so that `attempts` (which the worker
   * compares against `maxAttempts` and uses for the retry backoff) counts
   * consecutive failures of a single run rather than every run of the job
   */
  abstract success(options: SuccessOptions): void | Promise<void>

  /**
   * Called when an attempt to run a job produced an error and the job will
   * be retried.
   * This should update the stored job with the new `options.runAt` so that it
   * will be retried
   */
  abstract error(options: ErrorOptions): void | Promise<void>

  /**
   * Called, instead of `error()`, when a job will not be retried: it has
   * either errored maxAttempts times, or exceeded maxRuntime.
   * `options.error` contains the error to record
   */
  abstract failure(options: FailureOptions): void | Promise<void>

  /**
   * Clear all jobs from storage
   */
  abstract clear(): void | Promise<void>

  /**
   * Cancel a job so that it will not be run (if it's still queued) or not be
   * retried or picked up by another worker (if it's currently running).
   * Should return `true` if a job was cancelled and `false` if no cancellable
   * job with the given id was found.
   *
   * This method is optional: adapters that don't implement it don't support
   * cancellation and `later.cancel()` will throw a `CancelNotImplementedError`
   */
  cancel?(options: CancelOptions): boolean | Promise<boolean>

  /**
   * Pause a job, so that no worker picks it up until it's resumed. A run in
   * progress finishes, and a recurring job's next run stays paused: `success()`
   * and `error()` must keep the pause when they reschedule the job.
   *
   * Throws a `JobIdNotFoundError` when no job has the id, and a
   * `JobNotActiveError` when the job has completed or failed for good.
   *
   * This method is optional, together with `resume()`: adapters that don't
   * implement it don't support pausing, and `jobs.pauseJob()` throws a
   * `PauseNotImplementedError`
   */
  pause?(options: PauseOptions): PauseResult | Promise<PauseResult>

  /**
   * Resume a paused job. A recurring job runs next at the next match of its
   * cron from now, so runs missed while it was paused are not made up for. A
   * one-off job keeps its run time, so it runs right away when that has
   * passed. A job that isn't paused is left as it is.
   *
   * Throws like `pause()`
   */
  resume?(options: ResumeOptions): ResumeResult | Promise<ResumeResult>

  /**
   * List the jobs that are waiting to run, running or paused (not the
   * completed or failed ones), the ones that run next first. Used by
   * `yarn cedar jobs list` to find a job's id. Optional
   */
  list?(options: ListJobsOptions): ListedJob[] | Promise<ListedJob[]>
}
