import type { PrismaClient } from '@prisma/client'
import { camelCase } from 'change-case'

import { DEFAULT_MAX_RUNTIME, DEFAULT_MODEL_NAME } from '../../consts.js'
import type { BaseJob } from '../../types.js'
import type {
  BaseAdapterOptions,
  SchedulePayload,
  FindArgs,
  SuccessOptions,
  ErrorOptions,
  FailureOptions,
} from '../BaseAdapter/BaseAdapter.js'
import { BaseAdapter } from '../BaseAdapter/BaseAdapter.js'

import { ModelNameError } from './errors.js'

export interface PrismaJob extends BaseJob {
  id: number
  handler: string
  runAt: Date
  cron: string | null | undefined
  lockedAt: Date
  lockedBy: string
  lastError: string | null
  failedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface PrismaAdapterOptions<
  TDb extends PrismaClient = PrismaClient,
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
  db: TDb & { _activeProvider: string }

  /**
   * The camelCase name of the Prisma model accessor that represents the job
   * table, i.e. the key you'd use on `db` to query it.
   *
   * For a Prisma schema model named `BackgroundJob` this would be
   * `'backgroundJob'` (which is also the default). For a custom model named
   * `Job` this would be `'job'`.
   *
   * @default 'backgroundJob'
   */
  model?: keyof TDb
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
 *   createdAt DateTime  \@default(now())
 *   updatedAt DateTime  \@updatedAt
 * }
 * ```
 */
export class PrismaAdapter<
  TDb extends PrismaClient = PrismaClient,
> extends BaseAdapter<PrismaAdapterOptions<TDb>> {
  db: TDb
  model: keyof TDb
  accessor: PrismaClient[keyof PrismaClient]
  provider: string

  constructor(options: PrismaAdapterOptions<TDb>) {
    super(options)

    this.db = options.db

    // name of the model as defined in schema.prisma
    this.model = options.model ?? (DEFAULT_MODEL_NAME as keyof TDb)

    // the function to call on `db` to make queries: `db.backgroundJob`
    // TODO: Remove the camelCase call in the next major release. It's only here
    // to keep the code backwards compatible
    const camelName = camelCase(String(this.model)) as keyof TDb
    this.accessor = this.db[camelName]

    // _activeProvider is an undocumented Prisma internal not present in the
    // public type surface
    // It's the database provider type: 'sqlite' | 'postgresql' | 'mysql'
    this.provider = options.db._activeProvider

    // validate that everything we need is available
    if (!this.accessor) {
      throw new ModelNameError(String(this.model))
    }
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
    const maxRuntimeExpire = new Date(
      new Date().getTime() + (maxRuntime || DEFAULT_MAX_RUNTIME * 1000),
    )

    // This query is gnarly but not so bad once you know what it's doing. For a
    // job to match it must:
    // - have a runtAt in the past
    // - is either not locked, or was locked more than `maxRuntime` ago,
    //   or was already locked by this exact process and never cleaned up
    // - doesn't have a failedAt, meaning we will stop retrying
    // Translates to:
    //   ((runAt <= ? AND (lockedAt IS NULL OR lockedAt < ?)) OR lockedBy = ?)
    //   AND failedAt IS NULL
    const where = {
      AND: [
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
      ],
    }

    // If queues is ['*'] then skip, otherwise add a WHERE...IN for the array of
    // queue names
    const whereWithQueue = where
    if (queues.length > 1 || queues[0] !== '*') {
      Object.assign(whereWithQueue, {
        AND: [...where.AND, { queue: { in: queues } }],
      })
    }

    // Actually query the DB
    // TODO: there may be more optimized versions of the locking queries in
    // Postgres and MySQL
    const job = await this.accessor.findFirst({
      select: { id: true, attempts: true },
      where: whereWithQueue,
      orderBy: [{ priority: 'asc' }, { runAt: 'asc' }],
      take: 1,
    })

    if (job) {
      // If one was found, try to lock it by updating the record with the
      // same WHERE clause as above (if another locked it in the meantime it
      // won't find any record to update)
      const whereWithQueueAndId = Object.assign(whereWithQueue, {
        AND: [...whereWithQueue.AND, { id: job.id }],
      })

      // Update and increment the attempts count
      const { count } = await this.accessor.updateMany({
        where: whereWithQueueAndId,
        data: {
          lockedAt: new Date(),
          lockedBy: processName,
          attempts: job.attempts + 1,
        },
      })

      // Assuming the update worked, return the full details of the job
      if (count) {
        const data = await this.accessor.findFirst({ where: { id: job.id } })
        const { name, path, args } = JSON.parse(data.handler)
        return { ...data, name, path, args }
      }
    }

    // If we get here then there were either no jobs, or the one we found was
    // locked by another worker
    return undefined
  }

  // Prisma queries are lazily evaluated and only sent to the db when they are
  // awaited, so do the await here to ensure they actually run (if the user
  // doesn't await the Promise then the queries will never be executed!)
  override async success({ job, runAt, deleteJob }: SuccessOptions<PrismaJob>) {
    this.logger.debug(`[CedarJS Jobs] Job ${job.id} success`)

    if (deleteJob) {
      await this.accessor.delete({ where: { id: job.id } })
    } else {
      await this.accessor.update({
        where: { id: job.id },
        data: {
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          runAt: runAt || null,
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

    await this.accessor.update({
      where: { id: job.id },
      data,
    })
  }

  // Job has had too many attempts, it has now permanently failed.
  override async failure({ job, deleteJob }: FailureOptions<PrismaJob>) {
    if (deleteJob) {
      await this.accessor.delete({ where: { id: job.id } })
    } else {
      await this.accessor.update({
        where: { id: job.id },
        data: { failedAt: new Date() },
      })
    }
  }

  // Schedules a job by creating a new record in the background job table
  override async schedule({
    name,
    path,
    args,
    runAt,
    cron,
    queue,
    priority,
  }: SchedulePayload) {
    await this.accessor.create({
      data: {
        handler: JSON.stringify({ name, path, args }),
        runAt,
        cron,
        queue,
        priority,
      },
    })
  }

  override async clear() {
    await this.accessor.deleteMany()
  }
}
