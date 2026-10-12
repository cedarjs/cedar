import type {
  BaseAdapter,
  ListedJob,
  PauseResult,
  ResumeResult,
} from '../adapters/BaseAdapter/BaseAdapter.js'
import {
  AdapterNameRequiredError,
  AdapterNotFoundError,
  PauseNotImplementedError,
} from '../errors.js'
import type {
  Adapters,
  BasicLogger,
  CreateSchedulerArgs,
  CreateSchedulerConfig,
  Job,
  JobDefinition,
  JobManagerConfig,
  QueueNames,
  WorkerConfig,
} from '../types.js'

import { Scheduler } from './Scheduler.js'
import type { WorkerOptions } from './Worker.js'
import { Worker } from './Worker.js'

/** Which adapter `pauseJob()`, `resumeJob()` and `listJobs()` use */
export interface JobAdapterOptions<TAdapters extends Adapters> {
  /**
   * The name of the adapter that stores the job. Can be left out when the
   * `JobManager` has a single adapter
   */
  adapter?: keyof TAdapters
}

export interface CreateWorkerArgs {
  index: number
  workoff: WorkerOptions['workoff']
  clear: WorkerOptions['clear']
  processName: string
}

export class JobManager<
  TAdapters extends Adapters,
  TQueues extends QueueNames,
  TLogger extends BasicLogger,
> {
  adapters: TAdapters
  queues: TQueues
  logger: TLogger
  workers: WorkerConfig<TAdapters, TQueues>[]

  constructor(
    config: JobManagerConfig<
      TAdapters,
      // This ensures that TQueues is never a string[]. It should be an array
      // of string literals (constructed by using `as const`)
      TQueues extends string[] ? never : TQueues,
      TLogger
    >,
  ) {
    this.adapters = config.adapters
    this.queues = config.queues
    this.logger = config.logger
    this.workers = config.workers
  }

  createScheduler<TAdapterName extends keyof TAdapters>(
    schedulerConfig: CreateSchedulerConfig<TAdapters, TAdapterName>,
  ) {
    const scheduler = new Scheduler({
      adapter: this.adapters[schedulerConfig.adapter],
      logger: schedulerConfig.logger ?? this.logger,
    })

    const schedule = <TJob extends Job<TQueues, any[]>>(
      job: TJob,
      ...argsAndOptions: CreateSchedulerArgs<TJob>
    ) => {
      const [possibleArgs, possibleOptions] = argsAndOptions
      const didPassArgs = Array.isArray(possibleArgs)

      const args = didPassArgs ? possibleArgs : []
      const options = didPassArgs ? possibleOptions : possibleArgs

      return scheduler.schedule({ job, args, options })
    }

    // Attach `cancel` to the scheduling function itself, so app code can do
    // `const job = await later(MyJob, [...])` and then `later.cancel(job.id)`
    return Object.assign(schedule, {
      cancel: (jobId: string | number) => scheduler.cancel(jobId),
    })
  }

  /**
   * Pauses a job, without a deploy: no worker picks it up until it's resumed
   * with `resumeJob()`. Works for any job that's waiting to run, recurring
   * (`cron`) or not. A run that's in progress finishes, and a recurring job's
   * next run stays paused.
   *
   * The pause is stored on the job's row. Code that deletes and recreates
   * its recurring jobs (like a script that schedules them on every deploy)
   * creates new rows, which aren't paused.
   *
   * Also available as `yarn cedar jobs pause <id>`.
   *
   * @param jobId The job's id, as returned by `later()` (or listed by
   * `listJobs()` and `yarn cedar jobs list`)
   *
   * @returns Whether the job was paused already, and since when it's paused
   *
   * @example
   * ```ts
   * await jobs.pauseJob(42)
   * ```
   */
  async pauseJob(
    jobId: string | number,
    options: JobAdapterOptions<TAdapters> = {},
  ): Promise<PauseResult> {
    const adapter = this.#adapter(options.adapter)

    if (!adapter.pause) {
      throw new PauseNotImplementedError('pause')
    }

    const result = await adapter.pause({ jobId })

    this.logger.info(
      result.alreadyPaused
        ? `[CedarJS Jobs] Job ${jobId} was already paused (since ` +
            `${result.pausedAt.toISOString()})`
        : `[CedarJS Jobs] Paused job ${jobId}`,
    )

    return result
  }

  /**
   * Resumes a job paused with `pauseJob()`.
   *
   * - A recurring (`cron`) job runs next the next time its cron matches from
   *   now. Runs missed while it was paused are not made up for.
   * - A one-off job keeps its run time, so it runs as soon as a worker is
   *   free when that time has passed.
   *
   * Resuming a job that isn't paused changes nothing. Also available as
   * `yarn cedar jobs resume <id>`.
   *
   * @returns Whether the job was paused, and when it runs next
   */
  async resumeJob(
    jobId: string | number,
    options: JobAdapterOptions<TAdapters> = {},
  ): Promise<ResumeResult> {
    const adapter = this.#adapter(options.adapter)

    if (!adapter.resume) {
      throw new PauseNotImplementedError('resume')
    }

    const result = await adapter.resume({ jobId })

    this.logger.info(
      result.wasPaused
        ? `[CedarJS Jobs] Resumed job ${jobId}, next run at ` +
            `${result.runAt?.toISOString()}`
        : `[CedarJS Jobs] Job ${jobId} isn't paused`,
    )

    return result
  }

  /**
   * Lists the jobs that are waiting to run, running or paused, the ones that
   * run next first, to find a job's id. Completed and failed jobs are left
   * out. Also available as `yarn cedar jobs list`.
   *
   * @param options.limit The most jobs to list. Default: 100
   */
  async listJobs(
    options: JobAdapterOptions<TAdapters> & { limit?: number } = {},
  ): Promise<ListedJob[]> {
    const adapter = this.#adapter(options.adapter)

    if (!adapter.list) {
      throw new PauseNotImplementedError('list')
    }

    return adapter.list({ limit: options.limit ?? 100 })
  }

  #adapter(name: keyof TAdapters | undefined): BaseAdapter {
    const names = Object.keys(this.adapters)

    if (name === undefined && names.length !== 1) {
      throw new AdapterNameRequiredError(names)
    }

    const adapterName = name ?? names[0]
    const adapter = this.adapters[adapterName]

    if (!adapter) {
      throw new AdapterNotFoundError(String(adapterName))
    }

    return adapter
  }

  createJob<TArgs extends unknown[]>(
    jobDefinition: JobDefinition<TQueues, TArgs>,
  ): Job<TQueues, TArgs> {
    // The cast is necessary because the JobDefinition type lacks the `name` and
    // `path` properties that are required by the Job type. These properties are
    // added to the job at build time by a plugin in the build process.
    return jobDefinition as Job<TQueues, TArgs>
  }

  createWorker({ index, workoff, clear, processName }: CreateWorkerArgs) {
    const config = this.workers[index]
    const adapter = this.adapters[config.adapter]
    if (!adapter) {
      throw new AdapterNotFoundError(config.adapter.toString())
    }

    return new Worker({
      adapter: this.adapters[config.adapter],
      logger: config.logger || this.logger,
      maxAttempts: config.maxAttempts,
      maxRuntime: config.maxRuntime,
      sleepDelay: config.sleepDelay,
      deleteFailedJobs: config.deleteFailedJobs,
      deleteSuccessfulJobs: config.deleteSuccessfulJobs,
      processName,
      queues: [config.queue].flat(),
      workoff,
      clear,
    })
  }
}
