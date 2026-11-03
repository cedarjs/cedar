// Defines the basic shape of a logger that CedarJS's Jobs will invoke to print
// debug messages. CedarJS's Jobs will fallback to use `console` if no logger is
// passed in to CedarJS or any adapter.

import type { BaseAdapter } from './adapters/BaseAdapter/BaseAdapter.js'

/** CedarJS's logger and the standard console logger conform to this shape. */
export interface BasicLogger {
  debug: (message?: any, ...optionalParams: any[]) => void
  info: (message?: any, ...optionalParams: any[]) => void
  warn: (message?: any, ...optionalParams: any[]) => void
  error: (message?: any, ...optionalParams: any[]) => void
}

/**
 * This is the minimum interface that a "job" must conform to in order to be
 * scheduled and executed by CedarJS's job engine.
 */
export interface BaseJob {
  id: string | number
  name: string
  path: string
  args: unknown[]
  attempts: number
  cron?: string | undefined | null
  /**
   * The job's unique key, for adapters that support keys. Declared schedules
   * have a key starting with `cedar:schedule:`
   */
  key?: string | undefined | null
}
export type PossibleBaseJob = BaseJob | undefined

export type Adapters = Record<string, BaseAdapter>

export type QueueNames = readonly [string, ...string[]]

export interface WorkerConfig<
  TAdapters extends Adapters,
  TQueues extends QueueNames,
> extends WorkerSharedOptions {
  /**
   * The name of the adapter to use for this worker. This must be one of the keys
   * in the `adapters` object when you created the `JobManager`.
   */
  adapter: keyof TAdapters

  /**
   * The queue or queues that this worker should work on. You can pass a single
   * queue name, an array of queue names, or the string `'*'` to work on all
   * queues.
   */
  queue: '*' | TQueues[number] | TQueues[number][]

  /**
   * The number of workers to spawn for this worker configuration.
   *
   * @default 1
   */
  count?: number

  /**
   * The logger to use for this worker. If not provided, the logger from the
   * `JobManager` will be used.
   */
  logger?: BasicLogger
}

export interface WorkerSharedOptions {
  /**
   * The maximum number of retries to attempt for a job before giving up.
   *
   * @default 24
   */
  maxAttempts?: number

  /**
   * The maximum amount of time in seconds that a job is allowed to run. A job
   * that runs longer than this is marked as failed (it will not be retried)
   * and the `AbortSignal` available inside the job via
   * `getJobExecutionContext()` is aborted. This is also how long a job's lock
   * can be held before another worker considers the lock stale and is allowed
   * to pick the job up again (which only happens if the locking worker
   * crashed and could not clean up after itself).
   *
   * @default 14,400 (4 hours)
   */
  maxRuntime?: number

  /**
   * Whether a job that exceeds its `maxAttempts` should be deleted from the
   * queue. If `false`, the job will remain in the queue but will not be
   * processed further.
   *
   * @default false
   */
  deleteFailedJobs?: boolean

  /**
   * Whether to keep succeeded jobs in the database after they have completed
   * successfully.
   *
   * @default true
   *
   */
  deleteSuccessfulJobs?: boolean

  /**
   * The amount of time in seconds to wait between polling the queue for new
   * jobs. Some adapters may not need this if they do not poll the queue and
   * instead rely on a subscription model.
   *
   * @default 5
   */
  sleepDelay?: number
}

export interface JobManagerConfig<
  TAdapters extends Adapters,
  TQueues extends QueueNames,
  TLogger extends BasicLogger,
> {
  /**
   * An object containing all of the adapters that this job manager will use.
   * The keys should be the names of the adapters and the values should be the
   * adapter instances.
   */
  adapters: TAdapters

  /**
   * The logger to use for this job manager. If not provided, the logger will
   * default to the console.
   */
  logger: TLogger

  /**
   * An array of all of queue names that jobs can be scheduled on to. Workers can
   * be configured to work on a selection of these queues.
   *
   * This should be an array of string literals.
   * If you're using TypeScript, you can use `as const`, like in
   * `['default', 'critical', 'low'] as const` to construct an array of string
   * literals
   */
  queues: TQueues

  /**
   * An array of worker configurations that define how jobs should be processed.
   */
  workers: WorkerConfig<TAdapters, TQueues>[]

  /**
   * The name of the adapter that stores the recurring schedules jobs declare
   * with `schedules` in `createJob()`. Can be left out when there is only one
   * adapter.
   */
  scheduleAdapter?: keyof TAdapters
}

export interface CreateSchedulerConfig<
  TAdapters extends Adapters,
  TAdapterName extends keyof TAdapters = keyof TAdapters,
> {
  /**
   * The name of the adapter to use for this scheduler. This must be one of the
   * keys in the `adapters` object when you created the `JobManager`.
   */
  adapter: TAdapterName

  /**
   * The logger to use for this scheduler. If not provided, the logger from the
   * `JobManager` will be used.
   */
  logger?: BasicLogger
}

export interface JobDefinition<
  TQueues extends QueueNames,
  TArgs extends unknown[] = [],
> {
  /**
   * The name of the queue that this job should always be scheduled on. This
   * must be one of the values in the `queues` array when you created the
   * `JobManager`.
   */
  queue: TQueues[number]

  /**
   * The priority of the job in the range of 1-100. The lower the number, the
   * higher the priority. The default is 50.
   * @default 50
   */
  priority?: PriorityValue

  /**
   * The recurring schedules this job runs on, declared in code. Every job
   * worker syncs the declared schedules to the adapter when it starts: missing
   * schedules are added, changed ones are updated and schedules that are no
   * longer declared are removed. There's no script to run after changing a
   * schedule, restarting the workers (which every deploy does) is enough.
   *
   * Each schedule has a `key` that identifies it, so one job can run on
   * several schedules with different arguments. The key can be left out when
   * the job has a single schedule.
   *
   * Declared schedules need an adapter that implements `syncSchedules()`,
   * like the `PrismaAdapter`.
   *
   * @example
   * ```ts
   * export const ReportJob = jobs.createJob({
   *   queue: 'default',
   *   schedules: [
   *     { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
   *     { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
   *   ],
   *   perform: async (kind: 'summary' | 'full') => {
   *     // ...
   *   },
   * })
   * ```
   */
  schedules?: readonly JobSchedule<NoInfer<TArgs>>[]

  /**
   * The function to run when this job is executed.
   *
   * @param args The arguments that were passed when the job was scheduled.
   */
  perform: (...args: TArgs) => Promise<void> | void
}

/**
 * One recurring schedule of a job, declared in the job's `schedules` array.
 */
export type JobSchedule<TArgs extends unknown[] = unknown[]> = {
  /**
   * Identifies this schedule among the job's schedules. The job's name and
   * this key together are the schedule's identity in the adapter: changing
   * the `cron` or `args` of a schedule updates it, changing its `key`
   * replaces it with a new one.
   *
   * Required when the job has more than one schedule.
   *
   * @default 'default'
   */
  key?: string

  /**
   * When the job runs, in the format described in the [cron-parser
   * documentation](https://github.com/harrisiirak/cron-parser#cron-format).
   * Evaluated in the time zone of the job worker.
   */
  cron: string
} & ([] extends TArgs
  ? {
      /** The arguments `perform()` gets on every run of this schedule */
      args?: TArgs
    }
  : {
      /** The arguments `perform()` gets on every run of this schedule */
      args: TArgs
    })

export type JobComputedProperties = {
  /**
   * The name of the job that was defined in the job file.
   */
  name: string

  /**
   * The path to the job file that this job was defined in.
   */
  path: string
}

export type Job<
  TQueues extends QueueNames,
  TArgs extends unknown[] = [],
> = JobDefinition<TQueues, TArgs> & JobComputedProperties

/** When a scheduled job runs */
export type ScheduleJobTiming =
  | {
      /** Without `wait`, `waitUntil` or `cron` the job runs right away */
      wait?: never
      waitUntil?: never
      cron?: never
    }
  | {
      /**
       * The number of seconds to wait before scheduling this job. This is
       * mutually exclusive with `waitUntil` and `cron`.
       */
      wait: number
      waitUntil?: never
      cron?: never
    }
  | {
      wait?: never
      /**
       * The date and time to schedule this job for. This is mutually exclusive
       * with `wait` and `cron`.
       */
      waitUntil: Date
      cron?: never
    }
  | {
      wait?: never
      waitUntil?: never
      /**
       * The cron schedule for this job. This is mutually exclusive with `wait`
       * and `waitUntil`.
       *
       * The supported format is described in the [cron-parser
       * documentation](https://github.com/harrisiirak/cron-parser#cron-format).
       * @see {@link https://github.com/harrisiirak/cron-parser#cron-format}
       */
      cron: string
    }

/**
 * Options for scheduling a job with `later()`: when it runs (`wait`,
 * `waitUntil` or `cron`) and, optionally, a unique `key`.
 */
export type ScheduleJobOptions = ScheduleJobTiming & {
  /**
   * Makes the job unique while it's queued: if a job scheduled with the same
   * key is still waiting to run, no new job is added and the adapter returns
   * the queued one instead (the `PrismaAdapter` returns it with
   * `alreadyQueued: true`).
   *
   * A job holds its key until a worker picks it up. From then on a new job
   * with the same key can be queued, so work requested while the job runs
   * isn't lost. A recurring (`cron`) job holds its key for as long as its
   * schedule is active.
   *
   * The key alone decides uniqueness: the arguments of the queued job are not
   * compared, so put whatever must be distinct into the key, like
   * `` `thumbnails:${caseId}` ``. Keys starting with `cedar:` are reserved.
   *
   * Needs an adapter that supports unique keys, like the `PrismaAdapter`
   * (which needs a `key String? @unique` column on its model).
   */
  key?: string
}

/**
 * A union of the integers from 0 up to, but not including, `TEnd`. `TEnd` must
 * be a non-negative integer literal.
 */
type NumbersBelow<
  TEnd extends number,
  TAcc extends number[] = [],
> = TAcc['length'] extends TEnd
  ? TAcc[number]
  : NumbersBelow<TEnd, [...TAcc, TAcc['length']]>

/** An integer from 1 to 100, inclusive */
type PriorityValue = Exclude<NumbersBelow<101>, 0>

/**
 * If the job has no arguments:
 *  - you may pass an empty array for the arguments and then optionally pass the
 *    scheduler options
 *  - you may optionally pass the scheduler options
 * If the job has arguments:
 *  - you must pass the arguments and then optionally pass the scheduler options
 */
export type CreateSchedulerArgs<TJob extends Job<QueueNames, any[]>> =
  Parameters<TJob['perform']> extends []
    ? [ScheduleJobOptions?] | [[], ScheduleJobOptions?]
    : [Parameters<TJob['perform']>, ScheduleJobOptions?]
