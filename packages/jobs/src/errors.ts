const JOBS_CONFIG_FILENAME = 'jobs.{ts,js}'

/**
 * Parent class for any CedarJS Jobs-related error
 */
export class CedarJSJobsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * Thrown when trying to configure a scheduler without an adapter
 */
export class AdapterNotConfiguredError extends CedarJSJobsError {
  constructor() {
    super('No adapter configured for the job scheduler')
  }
}

/**
 * Thrown when the Worker or Executor is instantiated without an adapter
 */
export class AdapterRequiredError extends CedarJSJobsError {
  constructor() {
    super('`adapter` is required to perform a job')
  }
}

/**
 * Thrown when the Worker is instantiated without an array of queues
 */
export class QueuesRequiredError extends CedarJSJobsError {
  constructor() {
    super('`queues` is required to find a job to run')
  }
}

/**
 * Thrown when the Executor is instantiated without a job
 */
export class JobRequiredError extends CedarJSJobsError {
  constructor() {
    super('`job` is required to perform a job')
  }
}

/**
 * Thrown when a job with the given handler is not found in the filesystem
 */
export class JobNotFoundError extends CedarJSJobsError {
  constructor(name: string) {
    super(`Job \`${name}\` not found in the filesystem`)
  }
}

/**
 * Thrown when a job file exists, but the export does not match the filename
 */
export class JobExportNotFoundError extends CedarJSJobsError {
  constructor(name: string) {
    super(`Job file \`${name}\` does not export a class with the same name`)
  }
}

/**
 * Thrown when the runner tries to import `adapter` from api/src/lib/jobs.js|ts and
 * the file does not exist
 */
export class JobsLibNotFoundError extends CedarJSJobsError {
  constructor() {
    super(
      `api/src/lib/${JOBS_CONFIG_FILENAME} not found. Run \`yarn cedar setup ` +
        'jobs` to create this file and configure background jobs. Already ' +
        "did that? You'll need to run `yarn cedar dev` or `yarn cedar build` " +
        'before you can start the job workers!',
    )
  }
}

/**
 * Thrown when the runner tries to import `adapter` from api/src/lib/jobs.js|ts
 */
export class AdapterNotFoundError extends CedarJSJobsError {
  constructor(name: string) {
    super(
      `api/src/lib/${JOBS_CONFIG_FILENAME} does not export an adapter named \`${name}\``,
    )
  }
}

/**
 * Thrown when the runner tries to import `logger` from api/src/lib/jobs.js|ts
 */
export class LoggerNotFoundError extends CedarJSJobsError {
  constructor(name: string) {
    super(
      `api/src/lib/${JOBS_CONFIG_FILENAME} does not export a logger named \`${name}\``,
    )
  }
}

/**
 * Thrown when the runner tries to import `workerConfig` from api/src/lib/jobs.js|ts
 */
export class WorkerConfigNotFoundError extends CedarJSJobsError {
  constructor(name: string) {
    super(`api/src/lib/#{JOBS_CONFIG_FILENAME} does not export \`${name}\``)
  }
}

/**
 * Parent class for any job error where we want to wrap the underlying error
 * in our own. Use by extending this class and passing the original error to
 * the constructor:
 *
 * ```typescript
 * try {
 *   throw new Error('Generic error')
 * } catch (e) {
 *    throw new RethrowJobError('Custom Error Message', e)
 * }
 * ```
 */
export class RethrownJobError extends CedarJSJobsError {
  originalError: Error
  stackBeforeRethrow: string | undefined

  constructor(message: string, error: Error) {
    super(message)

    if (!error) {
      throw new Error(
        'RethrownJobError requires a message and existing error object',
      )
    }

    this.originalError = error
    this.stackBeforeRethrow = this.stack

    const messageLines = (this.message.match(/\n/g) || []).length + 1
    this.stack =
      this.stack
        ?.split('\n')
        .slice(0, messageLines + 1)
        .join('\n') +
      '\n' +
      error.stack
  }
}

/**
 * Thrown when there is an error scheduling a job, wraps the underlying error
 */
export class SchedulingError extends RethrownJobError {
  constructor(message: string, error: Error) {
    super(message, error)
  }
}

/**
 * Thrown when there is an error performing a job, wraps the underlying error
 */
export class PerformError extends RethrownJobError {
  constructor(message: string, error: Error) {
    super(message, error)
  }
}

/**
 * Thrown (and recorded as the job's error) when a job runs longer than the
 * worker's `maxRuntime`
 */
export class JobTimeoutError extends CedarJSJobsError {
  constructor(jobIdentifier: string, maxRuntime: number) {
    super(
      `Job ${jobIdentifier} exceeded max runtime of ${maxRuntime} seconds ` +
        'and was marked as failed',
    )
  }
}

/**
 * Thrown when trying to cancel a job through an adapter that does not
 * implement the optional `cancel()` method
 */
export class CancelNotImplementedError extends CedarJSJobsError {
  constructor() {
    super('The configured adapter does not support cancelling jobs')
  }
}

export class QueueNotDefinedError extends CedarJSJobsError {
  constructor() {
    super('Scheduler requires a named `queue` to place jobs in')
  }
}

export class WorkerConfigIndexNotFoundError extends CedarJSJobsError {
  constructor(index: number) {
    super(`Worker index ${index} not found in jobs config`)
  }
}

/**
 * Thrown when scheduling a job with a unique `key` through an adapter that
 * doesn't support unique keys
 */
export class UniqueKeysNotSupportedError extends CedarJSJobsError {
  constructor() {
    super(
      'The configured adapter does not support unique job keys, so the job ' +
        'was not scheduled. Schedule it without `key`, or use an adapter ' +
        'that supports keys, like the PrismaAdapter',
    )
  }
}

/**
 * Thrown when a job is scheduled with a key that starts with the prefix
 * Cedar reserves for its own keys
 */
export class ReservedKeyError extends CedarJSJobsError {
  constructor(key: string, prefix: string) {
    super(
      `The job key \`${key}\` starts with \`${prefix}\`, which is reserved ` +
        'for keys Cedar creates itself, like the keys of declared schedules',
    )
  }
}

/**
 * Thrown when jobs declare `schedules` but the adapter that should store them
 * doesn't implement `syncSchedules()`
 */
export class SchedulesNotSupportedError extends CedarJSJobsError {
  constructor(adapterName: string) {
    super(
      `Jobs declare \`schedules\`, but the \`${adapterName}\` adapter does ` +
        'not support syncing declared schedules. Use an adapter that does, ' +
        'like the PrismaAdapter, and point `scheduleAdapter` in your ' +
        'JobManager config at it',
    )
  }
}

/**
 * Thrown when the jobs' declared `schedules` can't be synced as declared: a
 * schedule is missing its key, two schedules share an identity, a cron
 * expression doesn't parse, or it's unclear which adapter stores them
 */
export class ScheduleConfigError extends CedarJSJobsError {
  constructor(message: string) {
    super(`[CedarJS Jobs] ${message}`)
  }
}
