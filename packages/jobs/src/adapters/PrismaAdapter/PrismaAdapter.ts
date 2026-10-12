import { camelCase } from 'change-case'

import {
  DEFAULT_MAX_RUNTIME,
  DEFAULT_MODEL_NAME,
  MAX_RUNTIME_GRACE_PERIOD,
} from '../../consts.js'
import { CedarJSJobsError } from '../../errors.js'
import type { BaseJob } from '../../types.js'
import type {
  BaseAdapterOptions,
  SchedulePayload,
  ScheduleDefinition,
  SyncSchedulesOptions,
  SyncSchedulesResult,
  FindArgs,
  SuccessOptions,
  ErrorOptions,
  FailureOptions,
  CancelOptions,
  PauseScheduleOptions,
  PauseScheduleResult,
  ResumeScheduleOptions,
  ResumeScheduleResult,
  ListSchedulesOptions,
  StoredSchedule,
} from '../BaseAdapter/BaseAdapter.js'
import { BaseAdapter } from '../BaseAdapter/BaseAdapter.js'

import {
  KeyColumnMissingError,
  ModelNameError,
  PausedAtColumnMissingError,
} from './errors.js'

export interface PrismaJob extends BaseJob {
  id: number
  handler: string
  queue: string
  priority: number
  /** Null once the job has completed or permanently failed */
  runAt: Date | null
  cron: string | null | undefined
  /** Null unless the job is currently locked by a worker */
  lockedAt: Date | null
  /** Null unless the job is currently locked by a worker */
  lockedBy: string | null
  lastError: string | null
  failedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /**
   * The job's unique key. Only queued jobs and active recurring jobs hold
   * their key, it's null once a worker has picked up a non-recurring job.
   * Undefined when the model has no `key` column
   */
  key?: string | null
  /**
   * When the job's declared schedule was paused, or null when it isn't.
   * Workers don't pick up a paused job. Undefined when the model has no
   * `pausedAt` column
   */
  pausedAt?: Date | null
}

/** What `schedule()` returns: the stored job */
export interface ScheduledPrismaJob extends PrismaJob {
  /**
   * `true` when the job was scheduled with a `key` and a job with that key
   * was already queued. No new job was added, and this is the queued job
   */
  alreadyQueued: boolean
}

/**
 * How many times `schedule()` and `syncSchedules()` retry when the job that
 * holds a key releases it between their insert and their read. Each retry
 * means another worker picked up (or removed) the job in that moment, so
 * running out of retries takes a very busy key
 */
const MAX_KEY_RETRIES = 5

interface PrismaAdapterDelegate {
  findFirst(args: Record<string, unknown>): Promise<any>
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>
  delete(args: Record<string, unknown>): Promise<unknown>
  update(args: Record<string, unknown>): Promise<unknown>
  create(args: Record<string, unknown>): Promise<unknown>
  deleteMany(args?: Record<string, unknown>): Promise<unknown>
  /** Every Prisma delegate has it. Only `syncSchedules()` uses it */
  findMany?(args: Record<string, unknown>): Promise<any[]>
}

// TODO: See if we can tighten up this interface later once we've moved to
// Prisma v7
interface DelegateLike {
  findFirst: (...args: any[]) => any
  updateMany: (...args: any[]) => any
  delete: (...args: any[]) => any
  update: (...args: any[]) => any
  create: (...args: any[]) => any
  deleteMany: (...args: any[]) => any
}

type DelegateKey<TDb extends object> = Extract<
  {
    [K in keyof TDb]-?: TDb[K] extends DelegateLike ? K : never
  }[keyof TDb],
  string
>

function isPrismaAdapterDelegate(
  value: unknown,
): value is PrismaAdapterDelegate {
  const candidate = value as Partial<PrismaAdapterDelegate> | null

  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof candidate.findFirst === 'function' &&
    typeof candidate.updateMany === 'function' &&
    typeof candidate.delete === 'function' &&
    typeof candidate.update === 'function' &&
    typeof candidate.create === 'function' &&
    typeof candidate.deleteMany === 'function'
  )
}

function getDelegate(db: object, model: string) {
  const delegate = (db as Record<string, unknown>)[model]

  if (!isPrismaAdapterDelegate(delegate)) {
    throw new ModelNameError(model)
  }

  return delegate
}

function getActiveProvider(db: object) {
  const provider = (db as { _activeProvider?: unknown })._activeProvider

  if (typeof provider !== 'string') {
    console.warn(
      '[CedarJS Jobs] Could not determine Prisma active provider from db._activeProvider. ' +
        'Provider-specific behaviour may not work correctly.',
    )

    return ''
  }

  return provider
}

/** Whether `e` is Prisma's unique constraint violation error */
function isUniqueViolation(e: unknown) {
  return (
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002'
  )
}

/**
 * Whether `e` is the error Prisma throws for a query that uses a field the
 * model doesn't have
 */
function isMissingColumn(e: unknown, column: 'key' | 'pausedAt') {
  return (
    e instanceof Error &&
    e.name === 'PrismaClientValidationError' &&
    new RegExp(`Unknown (argument|field) \`${column}\``).test(e.message)
  )
}

function isMissingKeyColumn(e: unknown) {
  return isMissingColumn(e, 'key')
}

/**
 * The `key: null` that releases a job's key, if it holds one. Spread into a
 * write's `data`, so a model without a `key` column never sees the field
 */
function releaseKey(job: { key?: string | null }) {
  return job.key != null ? { key: null } : {}
}

/**
 * Turns a stored row into a job: the row plus the `name`, `path` and `args`
 * stored in its `handler`
 */
function rowToJob(row: Omit<PrismaJob, 'name' | 'path' | 'args'>): PrismaJob {
  const { name, path, args } = JSON.parse(row.handler)

  return { ...row, name, path, args }
}

export interface PrismaAdapterOptions<
  TDb extends object = object,
> extends BaseAdapterOptions {
  /**
   * An instance of PrismaClient which will be used to talk to the database.
   *
   * Typed generically so that `model` below is constrained to the model names
   * that actually exist in the user's schema. When the user passes their typed
   * db instance TypeScript infers TDb as the full generated client, giving
   * autocomplete on model names. `PrismaClient` is only the lower bound — in
   * v7 it may be a stub type, but TDb will still be inferred from the value
   * passed at the call site.
   */
  // _activeProvider is an undocumented Prisma internal not present in the
  // public type surface
  // It's the database provider type: 'sqlite' | 'postgresql' | 'mysql'
  db: TDb

  /**
   * The camelCase name of the Prisma model accessor that represents the job
   * table, i.e. the key you'd use on `db` to query it.
   *
   * For a Prisma schema model named `BackgroundJob` this would be
   * `'backgroundJob'` (which is also the default). For a custom model named
   * `Job` this would be `'job'`.
   *
   * @default 'BackgroundJob' for now, but will be 'backgroundJob' in the next
   * major release.
   */
  // TODO: Remove the `| string` part. It's only here to make this code
  // backward compatible with Cedar v2.6 and earlier
  model?: DelegateKey<TDb> | string
}

interface FailureData {
  lockedAt: null
  lockedBy: null
  lastError: string
  failedAt?: Date
  runAt: Date | null
}

/**
 * Implements a job adapter using Prisma ORM.
 *
 * Assumes a table exists with the following schema (the table name can be
 * customized):
 *
 * ```prisma
 * model BackgroundJob {
 *   id        Int       \@id \@default(autoincrement())
 *   attempts  Int       \@default(0)
 *   handler   String
 *   queue     String
 *   priority  Int
 *   runAt     DateTime
 *   cron      String?
 *   lockedAt  DateTime?
 *   lockedBy  String?
 *   lastError String?
 *   failedAt  DateTime?
 *   key       String?   \@unique
 *   pausedAt  DateTime?
 *   createdAt DateTime  \@default(now())
 *   updatedAt DateTime  \@updatedAt
 * }
 * ```
 */
export class PrismaAdapter<TDb extends object = object> extends BaseAdapter<
  PrismaAdapterOptions<TDb>,
  Promise<ScheduledPrismaJob>
> {
  override readonly supportsUniqueKeys = true

  db: TDb
  model: DelegateKey<TDb> | string
  accessor: PrismaAdapterDelegate
  provider: string

  /**
   * Whether the model has a `pausedAt` column, so `find()` has to leave out
   * paused jobs. Unknown until the first `find()`, which finds out by
   * filtering on the column
   */
  #hasPausedAtColumn: boolean | undefined

  constructor(options: PrismaAdapterOptions<TDb>) {
    super(options)

    this.db = options.db

    // camelCase name of the model, as accessed on `db`
    // TODO: Remove type casting of `options.model` in the next major release
    this.model = options.model || DEFAULT_MODEL_NAME

    // the function to call on `db` to make queries: `db.backgroundJob`
    // TODO: Remove the camelCase call in the next major release. It's only here
    // to keep the code backwards compatible
    const camelName = camelCase(String(this.model))
    this.accessor = getDelegate(this.db, camelName)

    // _activeProvider is an undocumented Prisma internal not present in the
    // public type surface
    // It's the database provider type: 'sqlite' | 'postgresql' | 'mysql'
    this.provider = getActiveProvider(options.db)
  }

  /**
   * Finds the next job to run, locking it so that no other process can pick it
   * The act of locking a job is dependant on the DB server, so we'll run some
   * raw SQL to do it in each case—Prisma doesn't provide enough flexibility
   * in their generated code to do this in a DB-agnostic way.
   */
  override async find({
    processName,
    maxRuntime,
    queues,
  }: FindArgs): Promise<PrismaJob | undefined> {
    // The oldest a job's lock is allowed to be before it's considered stale
    // and the job is eligible to be picked up by another worker. The grace
    // period gives the worker that locked the job time to enforce its own
    // `maxRuntime` timeout and mark the job as failed—without it, a second
    // worker could claim the job in the moment between the lock going stale
    // and the timeout being recorded
    const maxRuntimeExpire = new Date(
      new Date().getTime() -
        ((maxRuntime || DEFAULT_MAX_RUNTIME) + MAX_RUNTIME_GRACE_PERIOD) * 1000,
    )

    // This query is gnarly but not so bad once you know what it's doing. For a
    // job to match it must:
    // - have a runtAt in the past
    // - is either not locked, or was locked more than `maxRuntime` ago,
    //   or was already locked by this exact process and never cleaned up
    // - doesn't have a failedAt, meaning we will stop retrying
    // - isn't paused (only when the model has a `pausedAt` column)
    // - is in one of the worker's queues, unless it works on all queues
    // Translates to:
    //   ((runAt <= ? AND (lockedAt IS NULL OR lockedAt < ?)) OR lockedBy = ?)
    //   AND failedAt IS NULL AND pausedAt IS NULL AND queue IN (?)
    const conditions = (withPausedAt: boolean): Record<string, unknown>[] => [
      {
        OR: [
          {
            AND: [
              { runAt: { lte: new Date() } },
              {
                OR: [
                  { lockedAt: null },
                  {
                    lockedAt: {
                      lt: maxRuntimeExpire,
                    },
                  },
                ],
              },
            ],
          },
          { lockedBy: processName },
        ],
      },
      { failedAt: null },
      ...(withPausedAt ? [{ pausedAt: null }] : []),
      // If queues is ['*'] then skip, otherwise add a WHERE...IN for the
      // array of queue names
      ...(queues.length > 1 || queues[0] !== '*'
        ? [{ queue: { in: queues } }]
        : []),
    ]

    // Actually query the DB
    // TODO: there may be more optimized versions of the locking queries in
    // Postgres and MySQL
    // The whole row is read (no `select`) so `key` is included only when the
    // model has that column
    const findCandidate = (withPausedAt: boolean) =>
      this.accessor.findFirst({
        where: { AND: conditions(withPausedAt) },
        orderBy: [{ priority: 'asc' }, { runAt: 'asc' }],
        take: 1,
      })

    let job

    if (this.#hasPausedAtColumn === false) {
      job = await findCandidate(false)
    } else {
      try {
        job = await findCandidate(true)
        this.#hasPausedAtColumn = true
      } catch (e) {
        if (!isMissingColumn(e, 'pausedAt')) {
          throw e
        }

        // A model without the column has no paused jobs to leave out
        this.#hasPausedAtColumn = false
        job = await findCandidate(false)
      }
    }

    if (job) {
      // If one was found, try to lock it by updating the record with the
      // same WHERE clause as above (if another locked it in the meantime, or
      // its schedule was paused, it won't find any record to update)
      const whereWithId = {
        AND: [...conditions(this.#hasPausedAtColumn === true), { id: job.id }],
      }

      // Update and increment the attempts count. A non-recurring job releases
      // its unique key in the same write, so as soon as it's picked up a new
      // job with the same key can be queued. A recurring job keeps its key:
      // the same row is rescheduled after every run
      const { count } = await this.accessor.updateMany({
        where: whereWithId,
        data: {
          lockedAt: new Date(),
          lockedBy: processName,
          attempts: job.attempts + 1,
          ...(job.cron ? {} : releaseKey(job)),
        },
      })

      // Assuming the update worked, return the full details of the job
      if (count) {
        const data = await this.accessor.findFirst({ where: { id: job.id } })
        return rowToJob(data)
      }
    }

    // If we get here then there were either no jobs, or the one we found was
    // locked by another worker
    return undefined
  }

  /**
   * The `where` clause that matches the job's row only while it is still
   * locked by the claim that `find()` returned as `job`.
   *
   * `lockedAt` identifies the claim: every claim sets it to the time of
   * locking, and `find()` returns the value read back from the database, so
   * it compares equal to the stored value regardless of the column's
   * precision. Nothing else changes `lockedAt` while the job is locked, and
   * a newer claim of the same job sets its own, different `lockedAt`. `attempts` alone
   * is not unique per claim, because a successful run of a recurring job
   * resets it to 0, and `lockedBy` is not unique either, because worker
   * process names are deterministic and reused across restarts
   */
  #claimedBy(job: PrismaJob) {
    return {
      id: job.id,
      failedAt: null,
      attempts: job.attempts,
      lockedAt: job.lockedAt,
    }
  }

  // Prisma queries are lazily evaluated and only sent to the db when they are
  // awaited, so do the await here to ensure they actually run (if the user
  // doesn't await the Promise then the queries will never be executed!)
  //
  // All of these updates/deletes are done with updateMany/deleteMany guarded
  // on `failedAt: null` and on the job still being locked by this attempt's
  // claim (see `#claimedBy()`), so the in-flight attempt's outcome can't
  // overwrite or delete the row when:
  // - the job was cancelled (or otherwise permanently failed) while this
  //   attempt was running (`failedAt` is no longer null), or
  // - the job was reclaimed by another worker because this attempt stalled
  //   past `maxRuntime` plus the grace period, whether or not that newer
  //   claim has finished by the time this attempt's outcome is written
  override async success({ job, runAt, deleteJob }: SuccessOptions<PrismaJob>) {
    this.logger.debug(`[CedarJS Jobs] Job ${job.id} success`)

    if (deleteJob) {
      await this.accessor.deleteMany({
        where: this.#claimedBy(job),
      })
    } else {
      await this.accessor.updateMany({
        where: this.#claimedBy(job),
        data: {
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          runAt: runAt || null,
          // A rescheduled (cron) job starts its next run with a clean slate,
          // so `attempts` counts consecutive failures of a single run
          ...(runAt ? { attempts: 0 } : {}),
        },
      })
    }
  }

  // There was an error processing the job. Record the failure data and the new
  // runAt time.
  override async error({ job, runAt, error }: ErrorOptions<PrismaJob>) {
    this.logger.debug(`[CedarJS Jobs] Job ${job.id} failure`)

    const data: FailureData = {
      lockedAt: null,
      lockedBy: null,
      lastError: `${error.message}\n\n${error.stack}`,
      runAt,
    }

    await this.accessor.updateMany({
      where: this.#claimedBy(job),
      data,
    })
  }

  // The job will not be retried: it has either had too many attempts or
  // exceeded maxRuntime (in which case `error` is set so the timeout can be
  // recorded in the same single write that marks the job as failed)
  override async failure({ job, deleteJob, error }: FailureOptions<PrismaJob>) {
    if (deleteJob) {
      await this.accessor.deleteMany({
        where: this.#claimedBy(job),
      })
    } else {
      // A recurring job holds its key until here. Releasing it lets the job
      // be scheduled again (for a declared schedule: by the next sync)
      const data: {
        failedAt: Date
        runAt: null
        lastError?: string
        key?: null
      } = {
        failedAt: new Date(),
        runAt: null,
        ...releaseKey(job),
      }

      if (error) {
        data.lastError = `${error.message}\n\n${error.stack}`
      }

      await this.accessor.updateMany({
        where: this.#claimedBy(job),
        data,
      })
    }
  }

  /**
   * Schedules a job by creating a new record in the background job table.
   * Returns the created job so that callers get access to its `id` (to cancel
   * it later, poll its status, etc.)
   *
   * With a `key`, the `key` column's unique constraint makes sure only one
   * queued job holds the key, also when several processes schedule at once.
   * If the insert hits the constraint, the job that holds the key is
   * returned with `alreadyQueued: true` instead
   */
  override async schedule({
    name,
    path,
    args,
    runAt,
    cron,
    queue,
    priority,
    key,
  }: SchedulePayload): Promise<ScheduledPrismaJob> {
    const job = { name, path, args }
    const data = {
      handler: JSON.stringify(job),
      runAt,
      cron,
      queue,
      priority,
      ...(key !== undefined ? { key } : {}),
    }

    if (key === undefined) {
      return { ...(await this.#create(data, job)), alreadyQueued: false }
    }

    for (let attempt = 0; attempt <= MAX_KEY_RETRIES; attempt++) {
      try {
        return { ...(await this.#create(data, job)), alreadyQueued: false }
      } catch (e) {
        if (!isUniqueViolation(e)) {
          throw e
        }
      }

      const queued = await this.accessor.findFirst({ where: { key } })

      if (queued) {
        return { ...rowToJob(queued), alreadyQueued: true }
      }

      // The job that held the key was picked up (or removed) between the
      // insert and the read, so the key is free again: try again
    }

    throw new CedarJSJobsError(
      `Could not schedule ${name} with the key \`${key}\`: the key was ` +
        `taken and released again ${MAX_KEY_RETRIES + 1} times in a row`,
    )
  }

  async #create(
    data: Record<string, unknown>,
    job: Pick<PrismaJob, 'name' | 'path' | 'args'>,
  ): Promise<PrismaJob> {
    let row

    try {
      row = await this.accessor.create({ data })
    } catch (e) {
      if (isMissingKeyColumn(e)) {
        throw new KeyColumnMissingError(String(this.model))
      }

      throw e
    }

    // The delegate is untyped, but the shape of the created row is guaranteed
    // by the schema contract documented on this class
    return { ...(row as Omit<PrismaJob, 'name' | 'path' | 'args'>), ...job }
  }

  /**
   * Makes the stored declared schedules match `schedules`. Each schedule is
   * one row, identified by its unique `key`, so concurrent syncs can't create
   * duplicates: an insert that hits the unique constraint compares against
   * (and if needed updates) the row the other sync created instead
   */
  override async syncSchedules({
    schedules,
    keyPrefix,
  }: SyncSchedulesOptions): Promise<SyncSchedulesResult> {
    const result: SyncSchedulesResult = {
      created: [],
      updated: [],
      removed: [],
      unchanged: [],
      paused: [],
    }

    if (!this.accessor.findMany) {
      throw new ModelNameError(String(this.model))
    }

    let stored: PrismaJob[]

    try {
      stored = await this.accessor.findMany({
        where: { key: { startsWith: keyPrefix } },
      })
    } catch (e) {
      if (!isMissingKeyColumn(e)) {
        throw e
      }

      // Without a `key` column no schedules can be stored, so with none
      // declared there's nothing to do
      if (schedules.length === 0) {
        return result
      }

      throw new KeyColumnMissingError(String(this.model))
    }

    const storedByKey = new Map(stored.map((row) => [row.key, row]))

    for (const schedule of schedules) {
      const outcome = await this.#syncSchedule(
        schedule,
        storedByKey.get(schedule.key),
      )
      result[outcome].push(schedule.key)
    }

    const declared = new Set(schedules.map((schedule) => schedule.key))

    // The sync never writes `pausedAt`, so a paused schedule stays paused
    // through any update. Listing them makes a forgotten pause visible
    result.paused = stored
      .filter((row) => row.pausedAt && row.key && declared.has(row.key))
      .map((row) => row.key)
      .filter((key): key is string => !!key)

    const undeclared = stored
      .map((row) => row.key)
      .filter((key): key is string => !!key && !declared.has(key))

    if (undeclared.length > 0) {
      await this.accessor.deleteMany({ where: { key: { in: undeclared } } })
      result.removed.push(...undeclared)
    }

    return result
  }

  async #syncSchedule(
    schedule: ScheduleDefinition,
    stored: PrismaJob | undefined,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const { name, path, args, cron, runAt, queue, priority, key } = schedule
    const handler = JSON.stringify({ name, path, args })
    let row = stored

    for (let attempt = 0; attempt <= MAX_KEY_RETRIES; attempt++) {
      if (!row) {
        try {
          await this.accessor.create({
            data: { handler, runAt, cron, queue, priority, key },
          })

          return 'created'
        } catch (e) {
          if (!isUniqueViolation(e)) {
            throw e
          }
        }

        // Another worker created it first. Make sure it matches
        row = await this.accessor.findFirst({ where: { key } })

        if (!row) {
          continue
        }
      }

      const changes: Record<string, unknown> = {}

      if (row.handler !== handler) {
        changes.handler = handler
      }

      if (row.queue !== queue) {
        changes.queue = queue
      }

      if (row.priority !== priority) {
        changes.priority = priority
      }

      if (row.cron !== cron) {
        changes.cron = cron

        // A running job gets its next `runAt` when it finishes. Its worker
        // computes it from the cron it read when it picked up the job, so the
        // new cron applies from the run after that
        if (!row.lockedAt) {
          changes.runAt = runAt
        }
      }

      if (Object.keys(changes).length === 0) {
        return 'unchanged'
      }

      await this.accessor.updateMany({ where: { id: row.id }, data: changes })

      return 'updated'
    }

    throw new CedarJSJobsError(
      `Could not sync the schedule \`${key}\`: it was created and removed ` +
        `again ${MAX_KEY_RETRIES + 1} times in a row`,
    )
  }

  /**
   * Pauses a declared schedule by setting its `pausedAt`, which `find()`
   * leaves out. A run in progress finishes, and `success()` and `error()`
   * keep `pausedAt` when they reschedule it
   */
  override async pauseSchedule({
    key,
  }: PauseScheduleOptions): Promise<PauseScheduleResult | null> {
    const row = await this.#findSchedule(key)

    if (!row) {
      return null
    }

    if (row.pausedAt) {
      return { alreadyPaused: true, pausedAt: row.pausedAt }
    }

    const pausedAt = new Date()
    const { count } = await this.accessor.updateMany({
      where: { id: row.id, pausedAt: null },
      data: { pausedAt },
    })

    if (count === 0) {
      // Paused (or removed) by someone else since it was read
      const current = await this.#findSchedule(key)

      return current?.pausedAt
        ? { alreadyPaused: true, pausedAt: current.pausedAt }
        : null
    }

    return { alreadyPaused: false, pausedAt }
  }

  /**
   * Resumes a paused declared schedule with its next run at `runAt`. A
   * schedule that isn't running also starts its next run with a clean
   * slate: `attempts` is reset like after a successful run. A running one
   * keeps its `attempts`, which identify the run's claim (see
   * `#claimedBy()`), and gets its next run time from the worker when the run
   * finishes
   */
  override async resumeSchedule({
    key,
    runAt,
  }: ResumeScheduleOptions): Promise<ResumeScheduleResult | null> {
    const row = await this.#findSchedule(key)

    if (!row) {
      return null
    }

    if (!row.pausedAt) {
      return { wasPaused: false, runAt: row.runAt }
    }

    const { count } = await this.accessor.updateMany({
      where: { id: row.id, pausedAt: { not: null } },
      data: {
        pausedAt: null,
        runAt,
        ...(row.lockedAt ? {} : { attempts: 0 }),
      },
    })

    if (count === 0) {
      // Resumed (or removed) by someone else since it was read
      const current = await this.#findSchedule(key)

      return current ? { wasPaused: false, runAt: current.runAt } : null
    }

    return { wasPaused: true, runAt }
  }

  /**
   * Reads the active row of a declared schedule. The whole row is read, so
   * `pausedAt` is on it exactly when the model has the column
   */
  async #findSchedule(key: string): Promise<PrismaJob | null> {
    let row: PrismaJob | null

    try {
      row = await this.accessor.findFirst({ where: { key } })
    } catch (e) {
      if (isMissingKeyColumn(e)) {
        throw new KeyColumnMissingError(String(this.model))
      }

      throw e
    }

    if (row && !('pausedAt' in row)) {
      throw new PausedAtColumnMissingError(String(this.model))
    }

    return row
  }

  override async listSchedules({
    keyPrefix,
  }: ListSchedulesOptions): Promise<StoredSchedule[]> {
    if (!this.accessor.findMany) {
      throw new ModelNameError(String(this.model))
    }

    let rows: PrismaJob[]

    try {
      rows = await this.accessor.findMany({
        where: { key: { startsWith: keyPrefix } },
        orderBy: { key: 'asc' },
      })
    } catch (e) {
      // Without a `key` column no schedules are stored
      if (isMissingKeyColumn(e)) {
        return []
      }

      throw e
    }

    return rows.map((row) => ({
      key: row.key ?? '',
      cron: row.cron ?? null,
      runAt: row.runAt,
      pausedAt: row.pausedAt ?? null,
      running: !!row.lockedAt,
    }))
  }

  /**
   * Cancels a job by marking it as permanently failed so no worker will pick
   * it up (or retry it, if it's currently being worked on).
   *
   * If the job is currently running, the in-progress attempt is not
   * interrupted (the worker will stop it when `maxRuntime` is exceeded), but
   * it will not be retried and will not be picked up by another worker once
   * its lock goes stale.
   */
  override async cancel({ jobId }: CancelOptions) {
    this.logger.debug(`[CedarJS Jobs] Cancelling job ${jobId}`)

    // updateMany so that nothing throws if the job no longer exists, and so
    // we can make the update conditional on the job still being active:
    // not already failed (`failedAt: null`) and not already completed—a
    // completed job that's kept in the database has its `runAt` set to null,
    // while every active state (queued, running, awaiting retry, rescheduled
    // cron) has a non-null `runAt`
    //
    // The row is read first to see whether it holds a unique key, which the
    // cancelled job releases (the `key` column is optional, so it can't be
    // written unconditionally)
    const job: PrismaJob | null = await this.accessor.findFirst({
      where: { id: jobId },
    })

    const { count } = await this.accessor.updateMany({
      where: { id: jobId, failedAt: null, runAt: { not: null } },
      data: {
        failedAt: new Date(),
        lastError: 'Job cancelled by user',
        runAt: null,
        ...releaseKey(job ?? {}),
      },
    })

    return count > 0
  }

  override async clear() {
    await this.accessor.deleteMany()
  }
}
