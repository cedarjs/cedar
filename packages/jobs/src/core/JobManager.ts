import type {
  ScheduleDefinition,
  SyncSchedulesResult,
} from '../adapters/BaseAdapter/BaseAdapter.js'
import { DEFAULT_SCHEDULE_KEY, SCHEDULE_KEY_PREFIX } from '../consts.js'
import {
  AdapterNotFoundError,
  ScheduleConfigError,
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
  JobManagerConfig,
  QueueNames,
  WorkerConfig,
} from '../types.js'
import { nextCronRunAt } from '../util.js'

import { Scheduler } from './Scheduler.js'
import type { WorkerOptions } from './Worker.js'
import { Worker } from './Worker.js'

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
    const adapterName = this.#scheduleAdapterName()
    const adapter = this.adapters[adapterName]

    if (!adapter) {
      throw new AdapterNotFoundError(String(adapterName))
    }

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

    return result
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
    adapter: TAdapters[keyof TAdapters],
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
