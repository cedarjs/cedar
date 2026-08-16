import type {
  BaseAdapter,
  SchedulePayload,
} from '../adapters/BaseAdapter/BaseAdapter.js'
import {
  DEFAULT_LOGGER,
  DEFAULT_PRIORITY,
  DEFAULT_WAIT,
  DEFAULT_WAIT_UNTIL,
} from '../consts.js'
import {
  AdapterNotConfiguredError,
  CancelNotImplementedError,
  QueueNotDefinedError,
  SchedulingError,
} from '../errors.js'
import type {
  BasicLogger,
  Job,
  QueueNames,
  ScheduleJobOptions,
} from '../types.js'

interface SchedulerConfig<TAdapter extends BaseAdapter> {
  adapter: TAdapter
  logger?: BasicLogger
}

export class Scheduler<TAdapter extends BaseAdapter> {
  adapter: TAdapter
  logger: NonNullable<SchedulerConfig<TAdapter>['logger']>

  constructor({ adapter, logger }: SchedulerConfig<TAdapter>) {
    this.logger = logger ?? DEFAULT_LOGGER
    this.adapter = adapter

    if (!this.adapter) {
      throw new AdapterNotConfiguredError()
    }
  }

  computeRunAt({ wait, waitUntil }: { wait: number; waitUntil: Date | null }) {
    if (wait && wait > 0) {
      return new Date(Date.now() + wait * 1000)
    } else if (waitUntil) {
      return waitUntil
    } else {
      return new Date()
    }
  }

  buildPayload<TJob extends Job<QueueNames, unknown[]>>({
    job,
    args,
    options,
  }: {
    job: TJob
    args: Parameters<TJob['perform']> | never[]
    options?: ScheduleJobOptions
  }): SchedulePayload {
    const queue = job.queue
    const priority = job.priority ?? DEFAULT_PRIORITY
    const wait = options?.wait ?? DEFAULT_WAIT
    const waitUntil = options?.waitUntil ?? DEFAULT_WAIT_UNTIL
    const cron = options?.cron

    if (!queue) {
      throw new QueueNotDefinedError()
    }

    if (cron && (wait || waitUntil)) {
      throw new Error(
        'Cannot schedule a cron job with wait or waitUntil options',
      )
    }

    return {
      name: job.name,
      path: job.path,
      args: args ?? [],
      cron,
      runAt: this.computeRunAt({ wait, waitUntil }),
      queue,
      priority,
    }
  }

  async schedule<TJob extends Job<QueueNames, unknown[]>>({
    job,
    args,
    options,
  }: {
    job: TJob
    args: Parameters<TJob['perform']> | never[]
    options?: ScheduleJobOptions
  }) {
    const payload = this.buildPayload({
      job,
      args,
      options,
    })

    this.logger.info(payload, `[CedarJS Jobs] Scheduling ${job.name}`)

    try {
      return await this.adapter.schedule(payload)
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))

      throw new SchedulingError(
        `[CedarJS Jobs] Exception when scheduling ${payload.name}`,
        error,
      )
    }
  }

  /**
   * Cancel a scheduled job so that it will not be run (if it's still queued)
   * or not be retried (if it's currently running). Requires an adapter that
   * implements the optional `cancel()` method, like the `PrismaAdapter`.
   *
   * Returns whatever the adapter's `cancel()` returns (for the
   * `PrismaAdapter` that's `true` if a job was cancelled and `false` if no
   * cancellable job with the given id was found)
   */
  async cancel(jobId: string | number) {
    if (!this.adapter.cancel) {
      throw new CancelNotImplementedError()
    }

    this.logger.info(`[CedarJS Jobs] Cancelling job ${jobId}`)

    return await this.adapter.cancel({ jobId })
  }
}
