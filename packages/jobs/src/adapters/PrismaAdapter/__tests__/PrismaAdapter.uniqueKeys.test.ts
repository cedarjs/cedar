// Unique job keys, run against a real (SQLite) database: the guarantees come
// from the `key` column's unique constraint, which a mocked client can't show

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDb } from '../../../__tests__/helpers/testDb.js'
import { mockLogger } from '../../../core/__tests__/mocks.js'
import { JobManager } from '../../../core/JobManager.js'
import { ReservedKeyError } from '../../../errors.js'
import type { Job, QueueNames } from '../../../types.js'
import { KeyColumnMissingError } from '../errors.js'
import { PrismaAdapter } from '../PrismaAdapter.js'

const [db, otherDb] = createTestDb('uniqueKeys')

afterAll(async () => {
  await db.$disconnect()
  await otherDb.$disconnect()
})

const managerFor = (client: typeof db, model?: string) =>
  new JobManager({
    adapters: {
      prisma: new PrismaAdapter({ db: client, model, logger: mockLogger }),
    },
    queues: ['default'] as const,
    logger: mockLogger,
    workers: [],
  })

const jobs = managerFor(db)
const later = jobs.createScheduler({ adapter: 'prisma' })
const otherLater = managerFor(otherDb).createScheduler({ adapter: 'prisma' })
const adapter = jobs.adapters.prisma

/** What the build adds to every job: its name and path */
const named = <TJob extends object>(job: TJob, name: string) =>
  Object.assign(job, { name, path: `${name}/${name}` })

const ThumbnailsJob = named(
  jobs.createJob({
    queue: 'default',
    perform: async (_caseId: string) => {},
  }),
  'ThumbnailsJob',
)

const findJob = (processName = 'worker.0') =>
  adapter.find({ processName, maxRuntime: 60, queues: ['default'] })

const queuedWithKey = (key: string) =>
  db.backgroundJob.findMany({ where: { key } })

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
  await db.legacyBackgroundJob.deleteMany()
})

describe('scheduling with a key', () => {
  it('adds the job and stores its key', async () => {
    const job = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    expect(job.alreadyQueued).toBe(false)
    expect(job.key).toBe('thumbs:1')
    expect(job.args).toEqual(['case-1'])
    expect(await db.backgroundJob.count()).toBe(1)
  })

  it('skips a second job with the same key while the first is queued', async () => {
    const first = await later(ThumbnailsJob, ['case-1'], {
      key: 'thumbs:1',
      wait: 30,
    })
    const second = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    expect(second.alreadyQueued).toBe(true)
    expect(second.id).toBe(first.id)
    // The queued job is returned as it is: its own args and runAt
    expect(second.runAt).toEqual(first.runAt)
    expect(await db.backgroundJob.count()).toBe(1)
  })

  it('compares only the key, not the arguments', async () => {
    await later(ThumbnailsJob, ['case-1'], { key: 'thumbs' })
    const second = await later(ThumbnailsJob, ['case-2'], { key: 'thumbs' })

    expect(second.alreadyQueued).toBe(true)
    expect(second.args).toEqual(['case-1'])
  })

  it('adds jobs with different keys, and jobs without a key', async () => {
    await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })
    await later(ThumbnailsJob, ['case-2'], { key: 'thumbs:2' })
    await later(ThumbnailsJob, ['case-1'])
    const withoutKey = await later(ThumbnailsJob, ['case-1'])

    expect(withoutKey.alreadyQueued).toBe(false)
    expect(await db.backgroundJob.count()).toBe(4)
  })

  it('allows a new job once a worker has picked up the queued one', async () => {
    const first = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    const running = await findJob()
    expect(running?.id).toBe(first.id)
    // Picking the job up releases its key
    expect(running?.key).toBeNull()

    const second = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    expect(second.alreadyQueued).toBe(false)
    expect(second.id).not.toBe(first.id)
    expect(await queuedWithKey('thumbs:1')).toHaveLength(1)
  })

  it('allows a new job once the queued one has run', async () => {
    await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })
    const running = await findJob()
    await adapter.success({ job: running!, runAt: undefined, deleteJob: false })

    const next = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    expect(next.alreadyQueued).toBe(false)
    expect(await db.backgroundJob.count()).toBe(2)
  })

  it('allows a new job once the queued one is cancelled', async () => {
    const first = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    expect(await later.cancel(first.id)).toBe(true)

    const next = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })
    expect(next.alreadyQueued).toBe(false)
  })

  it('a job waiting for a retry does not hold its key', async () => {
    await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })
    const running = await findJob()
    await adapter.error({
      job: running!,
      runAt: new Date(Date.now() + 60_000),
      error: new Error('Try again'),
    })

    const next = await later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' })

    expect(next.alreadyQueued).toBe(false)
  })

  it('a recurring job holds its key while its schedule is active', async () => {
    const first = await later(ThumbnailsJob, ['all'], {
      cron: '* * * * * *',
      key: 'thumbs:cron',
    })
    const second = await later(ThumbnailsJob, ['all'], {
      cron: '* * * * * *',
      key: 'thumbs:cron',
    })
    expect(second.alreadyQueued).toBe(true)

    // Wait for the first run's time to come
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const running = await findJob()
    expect(running?.id).toBe(first.id)
    expect(running?.key).toBe('thumbs:cron')

    await adapter.success({
      job: running!,
      runAt: new Date(Date.now() + 1000),
    })
    expect((await queuedWithKey('thumbs:cron'))[0].id).toBe(first.id)

    // Until it fails for good
    const again = await findJob()
    expect(again).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const lastRun = await findJob()
    await adapter.failure({ job: lastRun!, error: new Error('Broken') })
    expect(await queuedWithKey('thumbs:cron')).toHaveLength(0)
  })

  it('rejects keys with the reserved `cedar:` prefix', async () => {
    await expect(
      later(ThumbnailsJob, ['case-1'], { key: 'cedar:schedule:x:y' }),
    ).rejects.toThrow(ReservedKeyError)
  })
})

describe('concurrency', () => {
  it('concurrent enqueues with the same key add one job', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? later : otherLater)(ThumbnailsJob, ['case-1'], {
          key: 'thumbs:1',
        }),
      ),
    )

    expect(results.filter((job) => !job.alreadyQueued)).toHaveLength(1)
    expect(new Set(results.map((job) => job.id)).size).toBe(1)
    expect(await db.backgroundJob.count()).toBe(1)
  })

  it('never has two queued jobs with one key while workers pick them up', async () => {
    const otherAdapter = new PrismaAdapter({ db: otherDb, logger: mockLogger })

    for (let round = 0; round < 10; round++) {
      await Promise.all([
        later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' }),
        findJob(`worker.${round}`),
        otherLater(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' }),
        otherAdapter.find({
          processName: `other.${round}`,
          maxRuntime: 60,
          queues: ['default'],
        }),
        later(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' }),
      ])

      const holders = await queuedWithKey('thumbs:1')
      expect(holders.length).toBeLessThanOrEqual(1)
      expect(holders.every((row) => row.lockedAt === null)).toBe(true)
    }
  })
})

describe('a model without a `key` column', () => {
  const legacy = managerFor(db, 'legacyBackgroundJob')
  const legacyLater = legacy.createScheduler({ adapter: 'prisma' })
  const legacyAdapter = legacy.adapters.prisma

  it('schedules, runs and cancels jobs without a key', async () => {
    const job = await legacyLater(ThumbnailsJob, ['case-1'])
    expect(job.alreadyQueued).toBe(false)
    expect(job.key).toBeUndefined()

    const running = await legacyAdapter.find({
      processName: 'worker.0',
      maxRuntime: 60,
      queues: ['default'],
    })
    expect(running?.id).toBe(job.id)
    await legacyAdapter.failure({ job: running!, error: new Error('Broken') })

    const cancellable = await legacyLater(ThumbnailsJob, ['case-2'])
    expect(await legacyLater.cancel(cancellable.id)).toBe(true)
  })

  it('explains the missing column when a job is scheduled with a key', async () => {
    await expect(
      legacyLater(ThumbnailsJob, ['case-1'], { key: 'thumbs:1' }),
    ).rejects.toMatchObject({
      originalError: expect.any(KeyColumnMissingError),
    })
  })

  it('has nothing to sync when no job declares schedules', async () => {
    const jobsWithoutSchedules: Job<QueueNames, any[]>[] = [ThumbnailsJob]

    expect(await legacy.syncSchedules(jobsWithoutSchedules)).toEqual({
      created: [],
      updated: [],
      removed: [],
      unchanged: [],
      paused: [],
    })
  })

  it('explains the missing column when jobs declare schedules', async () => {
    const ScheduledJob = named(
      legacy.createJob({
        queue: 'default',
        schedules: [{ cron: '0 * * * *' }],
        perform: async () => {},
      }),
      'ScheduledJob',
    )

    await expect(legacy.syncSchedules([ScheduledJob])).rejects.toThrow(
      KeyColumnMissingError,
    )
  })
})
