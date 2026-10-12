import type {
  BaseAdapter,
  PauseScheduleResult,
  ResumeScheduleResult,
  ScheduleDefinition,
  StoredSchedule,
  SyncSchedulesResult,
} from '../adapters/BaseAdapter/BaseAdapter.js'
import { DEFAULT_SCHEDULE_KEY, SCHEDULE_KEY_PREFIX } from '../consts.js'
import {
  AdapterNotFoundError,
  ScheduleConfigError,
  ScheduleNotFoundError,
  SchedulePausingNotSupportedError,
  SchedulesNotSupportedError,
} from '../errors.js'
import { loadAllJobs } from '../loaders.js'
import type {
  Adapters,
  BasicLogger,
  CreateSchedulerArgs,
  CreateSchedulerConfig,
  Job,
  JobDefinition,
  JobSchedule,
  JobManagerConfig,
  QueueNames,
  WorkerConfig,
} from '../types.js'
import { nextCronRunAt } from '../util.js'

import { Scheduler } from './Scheduler.js'
import type { WorkerOptions } from './Worker.js'
import { Worker } from './Worker.js'

/** What `jobs.pauseSchedule()` returns */
export interface PausedSchedule extends PauseScheduleResult {
  /** The stored key of the schedule, like `cedar:schedule:ReportJob:nightly` */
  key: string
}

/** What `jobs.resumeSchedule()` returns */
export interface ResumedSchedule extends ResumeScheduleResult {
  /** The stored key of the schedule, like `cedar:schedule:ReportJob:nightly` */
  key: string
}

/** A stored declared schedule, as `jobs.listSchedules()` returns it */
export interface ListedSchedule extends StoredSchedule {
  /** The name of the job the schedule runs */
  jobName: string
  /** The schedule's own key, `default` for a job's only schedule */
  scheduleKey: string
}

/**
 * How a declared schedule is named on the command line and in logs:
 * `ReportJob:nightly`
 */
export const scheduleName = (storedKey: string) =>
  storedKey.startsWith(SCHEDULE_KEY_PREFIX)
    ? storedKey.slice(SCHEDULE_KEY_PREFIX.length)
    : storedKey

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
  scheduleAdapter: keyof TAdapters | undefined

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
    this.scheduleAdapter = config.scheduleAdapter
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

  createJob<TArgs extends unknown[]>(
    jobDefinition: JobDefinition<TQueues, TArgs>,
  ): Job<TQueues, TArgs> {
    // The cast is necessary because the JobDefinition type lacks the `name` and
    // `path` properties that are required by the Job type. These properties are
    // added to the job at build time by a plugin in the build process.
    return jobDefinition as Job<TQueues, TArgs>
  }

  /**
   * Makes the recurring schedules stored by the schedule adapter match the
   * `schedules` the jobs declare in `createJob()`: adds missing ones, updates
   * changed ones and removes the ones that are no longer declared. Safe to
   * run from several processes at once.
   *
   * Every job worker calls this when it starts, so there's usually no need
   * to call it yourself.
   *
   * @param jobs The jobs to read declared schedules from. Defaults to every
   * job in the project (see `loadAllJobs()`), which is what the sync has to
   * see to know which stored schedules are no longer declared.
   *
   * @returns What the sync did, or `undefined` if there was nothing to sync:
   * no job declares schedules and the adapter can't store them
   */
  async syncSchedules(
    jobs?: Job<TQueues, any[]>[],
  ): Promise<SyncSchedulesResult | undefined> {
    const allJobs = jobs ?? (await loadAllJobs())
    const { adapter, adapterName } = this.#scheduleAdapter()

    const schedules = this.#scheduleDefinitions(allJobs, adapter)

    if (!adapter.syncSchedules) {
      if (schedules.length > 0) {
        throw new SchedulesNotSupportedError(String(adapterName))
      }

      return undefined
    }

    const result = await adapter.syncSchedules({
      schedules,
      keyPrefix: SCHEDULE_KEY_PREFIX,
    })

    const changes = [
      ...result.created.map((key) => `created ${key}`),
      ...result.updated.map((key) => `updated ${key}`),
      ...result.removed.map((key) => `removed ${key}`),
    ]

    if (changes.length > 0) {
      this.logger.info(
        `[CedarJS Jobs] Synced declared schedules: ${changes.join(', ')}`,
      )
    } else {
      this.logger.debug(
        `[CedarJS Jobs] Declared schedules are up to date ` +
          `(${result.unchanged.length})`,
      )
    }

    // A warning rather than info, so a pause that was forgotten shows up in
    // the logs of every worker start, also with production log levels
    if (result.paused && result.paused.length > 0) {
      const names = result.paused.map(scheduleName)

      this.logger.warn(
        `[CedarJS Jobs] Paused declared schedules, which don't run until ` +
          `they're resumed: ${names.join(', ')}. Resume one with ` +
          `\`yarn cedar jobs resume ${names[0]}\``,
      )
    }

    return result
  }

  /**
   * Pauses one of the schedules a job declares, without a deploy: no worker
   * picks it up until it's resumed with `resumeSchedule()`. A run that's in
   * progress finishes. The pause is stored with the schedule, so it holds
   * across worker restarts and schedule syncs. A schedule that's no longer
   * declared is still removed by the next sync, paused or not.
   *
   * Also available as `yarn cedar jobs pause ReportJob:nightly`.
   *
   * @param job The job that declares the schedule
   * @param key The schedule's key. Can be left out when the job declares a
   * single schedule
   *
   * @returns The schedule's stored key, whether it was paused already and
   * since when it's paused
   *
   * @example
   * ```ts
   * await jobs.pauseSchedule(ReportJob, 'nightly')
   * ```
   */
  async pauseSchedule(
    job: Job<TQueues, any[]>,
    key?: string,
  ): Promise<PausedSchedule> {
    const { storedKey } = this.#declaredSchedule(job, key)
    const { adapter, adapterName } = this.#scheduleAdapter()

    if (!adapter.pauseSchedule) {
      throw new SchedulePausingNotSupportedError(adapterName, 'pauseSchedule')
    }

    const result = await adapter.pauseSchedule({ key: storedKey })

    if (!result) {
      throw this.#notStoredError(storedKey)
    }

    this.logger.info(
      result.alreadyPaused
        ? `[CedarJS Jobs] Schedule ${scheduleName(storedKey)} was already ` +
            `paused (since ${result.pausedAt.toISOString()})`
        : `[CedarJS Jobs] Paused schedule ${scheduleName(storedKey)}`,
    )

    return { ...result, key: storedKey }
  }

  /**
   * Resumes a schedule paused with `pauseSchedule()`. Its next run is the
   * next time its `cron` matches from now: runs missed while it was paused
   * are not made up for. Resuming a schedule that isn't paused changes
   * nothing.
   *
   * Also available as `yarn cedar jobs resume ReportJob:nightly`.
   *
   * @param job The job that declares the schedule
   * @param key The schedule's key. Can be left out when the job declares a
   * single schedule
   *
   * @returns The schedule's stored key, whether it was paused and when it
   * runs next
   */
  async resumeSchedule(
    job: Job<TQueues, any[]>,
    key?: string,
  ): Promise<ResumedSchedule> {
    const { schedule, storedKey } = this.#declaredSchedule(job, key)
    const { adapter, adapterName } = this.#scheduleAdapter()

    if (!adapter.resumeSchedule) {
      throw new SchedulePausingNotSupportedError(adapterName, 'resumeSchedule')
    }

    const result = await adapter.resumeSchedule({
      key: storedKey,
      runAt: nextCronRunAt(schedule.cron),
    })

    if (!result) {
      throw this.#notStoredError(storedKey)
    }

    this.logger.info(
      result.wasPaused
        ? `[CedarJS Jobs] Resumed schedule ${scheduleName(storedKey)}, next ` +
            `run at ${result.runAt?.toISOString()}`
        : `[CedarJS Jobs] Schedule ${scheduleName(storedKey)} isn't paused`,
    )

    return { ...result, key: storedKey }
  }

  /**
   * Lists the declared schedules the schedule adapter stores, with their
   * next run and whether they're paused. Also available as
   * `yarn cedar jobs schedules`
   */
  async listSchedules(): Promise<ListedSchedule[]> {
    const { adapter, adapterName } = this.#scheduleAdapter()

    if (!adapter.listSchedules) {
      throw new SchedulePausingNotSupportedError(adapterName, 'listSchedules')
    }

    const stored = await adapter.listSchedules({
      keyPrefix: SCHEDULE_KEY_PREFIX,
    })

    return stored.map((schedule) => {
      const name = scheduleName(schedule.key)
      const separator = name.indexOf(':')

      return {
        ...schedule,
        jobName: separator === -1 ? name : name.slice(0, separator),
        scheduleKey: separator === -1 ? '' : name.slice(separator + 1),
      }
    })
  }

  #scheduleAdapter(): { adapter: BaseAdapter; adapterName: string } {
    const adapterName = this.#scheduleAdapterName()
    const adapter = this.adapters[adapterName]

    if (!adapter) {
      throw new AdapterNotFoundError(String(adapterName))
    }

    return { adapter, adapterName: String(adapterName) }
  }

  /**
   * Finds the schedule `job` declares with `key`, or its only schedule when
   * `key` is left out
   */
  #declaredSchedule(
    job: Job<TQueues, any[]>,
    key: string | undefined,
  ): { schedule: JobSchedule<any[]>; storedKey: string } {
    const schedules = job.schedules ?? []
    const keyOf = (schedule: JobSchedule<any[]>) =>
      schedule.key ?? DEFAULT_SCHEDULE_KEY
    const declaredKeys = schedules.map(keyOf).join(', ')

    if (schedules.length === 0) {
      throw new ScheduleNotFoundError(`${job.name} declares no schedules`)
    }

    let schedule: JobSchedule<any[]> | undefined

    if (key === undefined) {
      if (schedules.length > 1) {
        throw new ScheduleNotFoundError(
          `${job.name} declares ${schedules.length} schedules ` +
            `(${declaredKeys}), so say which one by its key`,
        )
      }

      schedule = schedules[0]
    } else {
      schedule = schedules.find((candidate) => keyOf(candidate) === key)
    }

    if (!schedule) {
      throw new ScheduleNotFoundError(
        `${job.name} declares no schedule with the key \`${key}\` ` +
          `(its schedules: ${declaredKeys})`,
      )
    }

    return {
      schedule,
      storedKey: `${SCHEDULE_KEY_PREFIX}${job.name}:${keyOf(schedule)}`,
    }
  }

  #notStoredError(storedKey: string) {
    return new ScheduleNotFoundError(
      `The schedule ${scheduleName(storedKey)} is declared but not stored. ` +
        'Job workers store the declared schedules when they start, so ' +
        'start (or restart) them and try again. A schedule that failed for ' +
        'good, or was cancelled, is stored again by the next worker start too',
    )
  }

  #scheduleAdapterName(): keyof TAdapters {
    if (this.scheduleAdapter !== undefined) {
      return this.scheduleAdapter
    }

    const names = Object.keys(this.adapters)

    if (names.length !== 1) {
      throw new ScheduleConfigError(
        'Set `scheduleAdapter` in your JobManager config to the adapter that ' +
          'stores the schedules jobs declare. It can only be left out when ' +
          `there is exactly one adapter (found: ${names.join(', ') || 'none'})`,
      )
    }

    return names[0]
  }

  /**
   * Turns the jobs' declared schedules into what the adapter stores, and
   * checks them: every schedule needs a key when its job has more than one,
   * identities must be unique, and every cron expression must parse
   */
  #scheduleDefinitions(
    jobs: Job<TQueues, any[]>[],
    adapter: BaseAdapter,
  ): ScheduleDefinition[] {
    const scheduler = new Scheduler({ adapter, logger: this.logger })
    const definitions: ScheduleDefinition[] = []
    const owners = new Map<string, string>()

    for (const job of jobs) {
      const jobSchedules = job.schedules ?? []

      for (const schedule of jobSchedules) {
        const scheduleKey = schedule.key ?? DEFAULT_SCHEDULE_KEY

        if (schedule.key === undefined && jobSchedules.length > 1) {
          throw new ScheduleConfigError(
            `${job.name} declares ${jobSchedules.length} schedules, so each ` +
              'of them needs a `key` to tell them apart',
          )
        }

        const key = `${SCHEDULE_KEY_PREFIX}${job.name}:${scheduleKey}`
        const owner = `${job.path} (${job.name})`
        const otherOwner = owners.get(key)

        if (otherOwner) {
          throw new ScheduleConfigError(
            otherOwner === owner
              ? `${job.name} declares more than one schedule with the key ` +
                  `\`${scheduleKey}\``
              : `Both ${otherOwner} and ${owner} declare a schedule with ` +
                  `the key \`${scheduleKey}\`. Schedules are identified by ` +
                  "the job's name and the schedule's key, so jobs with " +
                  'schedules need unique names',
          )
        }

        owners.set(key, owner)

        try {
          nextCronRunAt(schedule.cron)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)

          throw new ScheduleConfigError(
            `The \`${scheduleKey}\` schedule of ${job.name} has an invalid ` +
              `cron expression \`${schedule.cron}\`: ${message}`,
          )
        }

        const payload = scheduler.buildPayload({
          job,
          args: schedule.args ?? [],
          options: { cron: schedule.cron },
        })

        definitions.push({ ...payload, cron: schedule.cron, key })
      }
    }

    return definitions
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
