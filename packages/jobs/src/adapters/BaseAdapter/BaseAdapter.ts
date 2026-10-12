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
  /**
   * The job's unique key, if it was scheduled with one. Only passed to
   * adapters that set `supportsUniqueKeys`. While a job with this key is
   * still queued, the adapter must not add another one (see
   * `ScheduleJobOptions['key']`)
   */
  key?: string | undefined
}

/** A recurring schedule declared in code, as passed to `syncSchedules()` */
export interface ScheduleDefinition extends SchedulePayload {
  cron: string
  /**
   * The schedule's identity: `SCHEDULE_KEY_PREFIX`, the job's name and the
   * schedule's own key, like `cedar:schedule:ReportJob:nightly`
   */
  key: string
}

export interface SyncSchedulesOptions {
  /** Every schedule declared in the app's code */
  schedules: ScheduleDefinition[]
  /**
   * Every schedule key starts with this prefix. Stored schedules with this
   * prefix that are not in `schedules` must be removed
   */
  keyPrefix: string
}

/** The keys of the schedules `syncSchedules()` touched, by what it did */
export interface SyncSchedulesResult {
  created: string[]
  updated: string[]
  removed: string[]
  unchanged: string[]
  /**
   * The keys of the declared schedules that are stored as paused (see
   * `pauseSchedule()`). Optional: adapters that can't pause schedules leave
   * it out
   */
  paused?: string[]
}

export interface PauseScheduleOptions {
  /** The stored key of the schedule, like `cedar:schedule:ReportJob:nightly` */
  key: string
}

export interface PauseScheduleResult {
  /** `true` when the schedule was paused already, and nothing changed */
  alreadyPaused: boolean
  /** When the schedule was paused */
  pausedAt: Date
}

export interface ResumeScheduleOptions {
  /** The stored key of the schedule, like `cedar:schedule:ReportJob:nightly` */
  key: string
  /**
   * The schedule's next run: the next match of its `cron` after now, so runs
   * missed while it was paused are not made up for
   */
  runAt: Date
}

export interface ResumeScheduleResult {
  /** `false` when the schedule wasn't paused, and nothing changed */
  wasPaused: boolean
  /** When the schedule runs next */
  runAt: Date | null
}

export interface ListSchedulesOptions {
  /** List the stored schedules with a key that starts with this */
  keyPrefix: string
}

/** A stored declared schedule, as `listSchedules()` returns it */
export interface StoredSchedule {
  /** The stored key, like `cedar:schedule:ReportJob:nightly` */
  key: string
  cron: string | null
  /** When the schedule runs next */
  runAt: Date | null
  /** When the schedule was paused, or `null` when it isn't */
  pausedAt: Date | null
  /** Whether a worker is running the job right now */
  running: boolean
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

  /**
   * Whether `schedule()` honors `payload.key` (see `SchedulePayload['key']`).
   * Scheduling a job with a `key` through an adapter that doesn't throws a
   * `UniqueKeysNotSupportedError`, so a key is never silently ignored
   */
  readonly supportsUniqueKeys: boolean = false

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
   * Makes the stored recurring schedules match `options.schedules`, the ones
   * declared in code. Called by every job worker when it starts, so several
   * calls can run at the same time and must not create duplicates:
   * - a declared schedule without a stored job is created, with its `runAt`
   *   at the next match of its `cron`
   * - a stored schedule whose job name, path, args, queue, priority or cron
   *   differ from the declaration is updated
   * - a stored schedule (key starting with `options.keyPrefix`) that is not
   *   declared any more is removed
   *
   * This method is optional: declaring `schedules` on a job with an adapter
   * that doesn't implement it makes the workers throw a
   * `SchedulesNotSupportedError` when they start
   */
  syncSchedules?(
    options: SyncSchedulesOptions,
  ): SyncSchedulesResult | Promise<SyncSchedulesResult>

  /**
   * Pauses a stored declared schedule, so no worker picks it up until it's
   * resumed. A run that's in progress finishes, and its rescheduling must
   * keep the schedule paused. `syncSchedules()` must keep a schedule paused
   * too, even when it updates its cron or args.
   *
   * Returns `null` when no schedule with `options.key` is stored.
   *
   * This method is optional, together with `resumeSchedule()`: without them
   * `jobs.pauseSchedule()` and `jobs.resumeSchedule()` throw a
   * `SchedulePausingNotSupportedError`
   */
  pauseSchedule?(
    options: PauseScheduleOptions,
  ): PauseScheduleResult | null | Promise<PauseScheduleResult | null>

  /**
   * Resumes a paused declared schedule: its next run is at `options.runAt`.
   * A schedule that isn't paused is left as it is.
   *
   * Returns `null` when no schedule with `options.key` is stored
   */
  resumeSchedule?(
    options: ResumeScheduleOptions,
  ): ResumeScheduleResult | null | Promise<ResumeScheduleResult | null>

  /**
   * Lists the stored declared schedules (the jobs with a key starting with
   * `options.keyPrefix`), for `yarn cedar jobs schedules`. Optional
   */
  listSchedules?(
    options: ListSchedulesOptions,
  ): StoredSchedule[] | Promise<StoredSchedule[]>
}
