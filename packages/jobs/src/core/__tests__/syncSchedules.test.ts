// Declared schedules, synced by `JobManager.syncSchedules()` through the
// PrismaAdapter into a real (SQLite) database

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDb } from '../../__tests__/helpers/testDb.js'
import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import {
  ScheduleConfigError,
  SchedulesNotSupportedError,
} from '../../errors.js'
import type { Job, JobSchedule, QueueNames } from '../../types.js'
import { nextCronRunAt } from '../../util.js'
import { JobManager } from '../JobManager.js'

import { MockAdapter, mockLogger } from './mocks.js'

const [db, otherDb] = createTestDb('syncSchedules')

afterAll(async () => {
  await db.$disconnect()
  await otherDb.$disconnect()
})

const managerFor = (client: typeof db) =>
  new JobManager({
    adapters: {
      prisma: new PrismaAdapter({ db: client, logger: mockLogger }),
    },
    queues: ['default', 'low'] as const,
    logger: mockLogger,
    workers: [],
  })

const jobs = managerFor(db)
const otherJobs = managerFor(otherDb)

type AnyJob = Job<QueueNames, any[]>

/**
 * A job as the build makes it: `createJob()` plus the `name` and `path` the
 * build adds
 */
const makeJob = (
  name: string,
  schedules: readonly JobSchedule<any[]>[],
  options: { queue?: 'default' | 'low'; priority?: 10 | 50 } = {},
): AnyJob => {
  const job = jobs.createJob({
    queue: options.queue ?? 'default',
    priority: options.priority,
    schedules,
    perform: async (..._args: unknown[]) => {},
  })

  return Object.assign(job, { name, path: `${name}/${name}` })
}

const storedSchedules = () =>
  db.backgroundJob.findMany({
    where: { key: { startsWith: 'cedar:schedule:' } },
    orderBy: { key: 'asc' },
  })

const handlerOf = (row: { handler: string }) => JSON.parse(row.handler)

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
})

describe('syncing declared schedules', () => {
  const ReportJob = () =>
    makeJob('ReportJob', [
      { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
      { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
    ])
  const CleanupJob = () => makeJob('CleanupJob', [{ cron: '17 * * * *' }])

  it('creates the declared schedules', async () => {
    const result = await jobs.syncSchedules([ReportJob(), CleanupJob()])

    expect(result?.created).toEqual([
      'cedar:schedule:ReportJob:hourly',
      'cedar:schedule:ReportJob:nightly',
      'cedar:schedule:CleanupJob:default',
    ])

    const [cleanup, hourly, nightly] = await storedSchedules()

    expect(cleanup).toMatchObject({
      key: 'cedar:schedule:CleanupJob:default',
      cron: '17 * * * *',
      queue: 'default',
      priority: 50,
      runAt: nextCronRunAt('17 * * * *'),
    })
    expect(handlerOf(cleanup)).toEqual({
      name: 'CleanupJob',
      path: 'CleanupJob/CleanupJob',
      args: [],
    })
    expect(hourly.runAt).toEqual(nextCronRunAt('0 * * * *'))
    expect(nightly.runAt).toEqual(nextCronRunAt('0 3 * * *'))
  })

  it('keeps two schedules of one job, each with its own args', async () => {
    await jobs.syncSchedules([ReportJob()])

    const [hourly, nightly] = await storedSchedules()
    expect(handlerOf(hourly).args).toEqual(['summary'])
    expect(handlerOf(nightly).args).toEqual(['full'])

    // A worker runs each with its own args
    await db.backgroundJob.updateMany({ data: { runAt: new Date(0) } })
    const adapter = jobs.adapters.prisma
    const first = await adapter.find({
      processName: 'w.0',
      maxRuntime: 60,
      queues: ['default'],
    })
    const second = await adapter.find({
      processName: 'w.1',
      maxRuntime: 60,
      queues: ['default'],
    })
    expect([first?.args, second?.args]).toEqual(
      expect.arrayContaining([['summary'], ['full']]),
    )
  })

  it('is idempotent', async () => {
    await jobs.syncSchedules([ReportJob(), CleanupJob()])
    const before = await storedSchedules()

    const result = await jobs.syncSchedules([ReportJob(), CleanupJob()])

    expect(result).toEqual({
      created: [],
      updated: [],
      removed: [],
      unchanged: [
        'cedar:schedule:ReportJob:hourly',
        'cedar:schedule:ReportJob:nightly',
        'cedar:schedule:CleanupJob:default',
      ],
      paused: [],
    })
    expect(await storedSchedules()).toEqual(before)
  })

  it('updates a changed cron and moves the next run to match it', async () => {
    await jobs.syncSchedules([CleanupJob()])
    const [before] = await storedSchedules()

    const result = await jobs.syncSchedules([
      makeJob('CleanupJob', [{ cron: '*/5 * * * *' }]),
    ])

    expect(result?.updated).toEqual(['cedar:schedule:CleanupJob:default'])
    const [after] = await storedSchedules()
    expect(after.id).toBe(before.id)
    expect(after.cron).toBe('*/5 * * * *')
    expect(after.runAt).toEqual(nextCronRunAt('*/5 * * * *'))
  })

  it("updates changed args, queue and priority, and keeps the next run's time", async () => {
    await jobs.syncSchedules([CleanupJob()])
    const scheduledFor = new Date(Date.now() + 42_000)
    await db.backgroundJob.updateMany({ data: { runAt: scheduledFor } })

    const result = await jobs.syncSchedules([
      makeJob('CleanupJob', [{ cron: '17 * * * *', args: ['uploads'] }], {
        queue: 'low',
        priority: 10,
      }),
    ])

    expect(result?.updated).toEqual(['cedar:schedule:CleanupJob:default'])
    const [after] = await storedSchedules()
    expect(handlerOf(after).args).toEqual(['uploads'])
    expect(after.queue).toBe('low')
    expect(after.priority).toBe(10)
    expect(after.runAt).toEqual(scheduledFor)
  })

  it("doesn't move the next run of a schedule that's running", async () => {
    await jobs.syncSchedules([CleanupJob()])
    const lockedAt = new Date()
    await db.backgroundJob.updateMany({
      data: { lockedAt, lockedBy: 'w.0' },
    })
    const [before] = await storedSchedules()

    await jobs.syncSchedules([makeJob('CleanupJob', [{ cron: '* * * * *' }])])

    const [after] = await storedSchedules()
    expect(after.cron).toBe('* * * * *')
    expect(after.runAt).toEqual(before.runAt)
    expect(after.lockedAt).toEqual(lockedAt)
  })

  it('removes schedules that are no longer declared', async () => {
    await jobs.syncSchedules([ReportJob(), CleanupJob()])

    // CleanupJob is gone, and ReportJob runs nightly only
    const result = await jobs.syncSchedules([
      makeJob('ReportJob', [
        { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
      ]),
    ])

    expect(result?.removed.sort()).toEqual([
      'cedar:schedule:CleanupJob:default',
      'cedar:schedule:ReportJob:hourly',
    ])
    expect((await storedSchedules()).map((row) => row.key)).toEqual([
      'cedar:schedule:ReportJob:nightly',
    ])
  })

  it('removes every schedule when none are declared', async () => {
    await jobs.syncSchedules([ReportJob()])

    await jobs.syncSchedules([makeJob('ReportJob', [])])

    expect(await storedSchedules()).toEqual([])
  })

  it('leaves jobs it did not create alone', async () => {
    const later = jobs.createScheduler({ adapter: 'prisma' })
    const OtherJob = makeJob('OtherJob', [])
    await later(OtherJob, [], { cron: '0 0 * * *' })
    await later(OtherJob, [], { key: 'other:1' })
    await later(OtherJob, [])

    await jobs.syncSchedules([CleanupJob()])
    await jobs.syncSchedules([])

    expect(await db.backgroundJob.count()).toBe(3)
  })

  it('recreates a schedule that failed for good', async () => {
    await jobs.syncSchedules([CleanupJob()])
    await db.backgroundJob.updateMany({ data: { runAt: new Date(0) } })
    const adapter = jobs.adapters.prisma
    const running = await adapter.find({
      processName: 'w.0',
      maxRuntime: 60,
      queues: ['default'],
    })
    await adapter.failure({ job: running!, error: new Error('Broken') })

    const result = await jobs.syncSchedules([CleanupJob()])

    expect(result?.created).toEqual(['cedar:schedule:CleanupJob:default'])
    // The failed job stays, without its key, for its error to be read
    expect(await db.backgroundJob.count()).toBe(2)
  })
})

describe('concurrent syncs', () => {
  const declared = () => [
    makeJob('ReportJob', [
      { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
      { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
    ]),
    makeJob('CleanupJob', [{ cron: '17 * * * *' }]),
  ]

  it("don't create duplicates", async () => {
    // Like several workers starting at once
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? jobs : otherJobs).syncSchedules(declared()),
      ),
    )

    expect(await storedSchedules()).toHaveLength(3)
    expect(await db.backgroundJob.count()).toBe(3)
    // Each schedule was created exactly once
    const created = results.flatMap((result) => result?.created ?? [])
    expect(created.sort()).toEqual([
      'cedar:schedule:CleanupJob:default',
      'cedar:schedule:ReportJob:hourly',
      'cedar:schedule:ReportJob:nightly',
    ])
  })

  it('agree on a changed schedule', async () => {
    await jobs.syncSchedules(declared())

    const changed = () => [
      makeJob('ReportJob', [
        { key: 'hourly', cron: '30 * * * *', args: ['summary'] },
      ]),
    ]
    await Promise.all([
      jobs.syncSchedules(changed()),
      otherJobs.syncSchedules(changed()),
      jobs.syncSchedules(changed()),
    ])

    const rows = await storedSchedules()
    expect(rows.map((row) => [row.key, row.cron])).toEqual([
      ['cedar:schedule:ReportJob:hourly', '30 * * * *'],
    ])
  })
})

describe('invalid declarations', () => {
  it('needs a key for each schedule of a job with several', async () => {
    const job = makeJob('ReportJob', [
      { cron: '0 * * * *', args: ['summary'] },
      { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
    ])

    await expect(jobs.syncSchedules([job])).rejects.toThrow(
      /ReportJob declares 2 schedules, so each of them needs a `key`/,
    )
  })

  it('rejects two schedules of a job with the same key', async () => {
    const job = makeJob('ReportJob', [
      { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
      { key: 'hourly', cron: '0 3 * * *', args: ['full'] },
    ])

    await expect(jobs.syncSchedules([job])).rejects.toThrow(
      /more than one schedule with the key `hourly`/,
    )
  })

  it('rejects two jobs with the same name declaring the same key', async () => {
    const one = makeJob('ReportJob', [{ cron: '0 * * * *' }])
    const other = Object.assign(makeJob('ReportJob', [{ cron: '0 3 * * *' }]), {
      path: 'reports/ReportJob',
    })

    await expect(jobs.syncSchedules([one, other])).rejects.toThrow(
      ScheduleConfigError,
    )
  })

  it('rejects an invalid cron expression', async () => {
    const job = makeJob('ReportJob', [{ cron: 'every hour' }])

    await expect(jobs.syncSchedules([job])).rejects.toThrow(
      /invalid cron expression `every hour`/,
    )
  })

  it('changes nothing when a declaration is invalid', async () => {
    await jobs.syncSchedules([makeJob('CleanupJob', [{ cron: '17 * * * *' }])])

    await expect(
      jobs.syncSchedules([makeJob('ReportJob', [{ cron: 'nope' }])]),
    ).rejects.toThrow(ScheduleConfigError)

    expect(await storedSchedules()).toHaveLength(1)
  })
})

describe('the schedule adapter', () => {
  const job = makeJob('CleanupJob', [{ cron: '17 * * * *' }])

  it('must be named when there are several adapters', async () => {
    const manager = new JobManager({
      adapters: {
        prisma: new PrismaAdapter({ db, logger: mockLogger }),
        mock: new MockAdapter(),
      },
      queues: ['default'] as const,
      logger: mockLogger,
      workers: [],
    })

    await expect(manager.syncSchedules([job])).rejects.toThrow(
      /Set `scheduleAdapter`/,
    )
  })

  it('is the one named by `scheduleAdapter`', async () => {
    const manager = new JobManager({
      adapters: {
        mock: new MockAdapter(),
        prisma: new PrismaAdapter({ db, logger: mockLogger }),
      },
      queues: ['default'] as const,
      logger: mockLogger,
      workers: [],
      scheduleAdapter: 'prisma',
    })

    await manager.syncSchedules([job])

    expect(await storedSchedules()).toHaveLength(1)
  })

  it('must support syncing when jobs declare schedules', async () => {
    const manager = new JobManager({
      adapters: { mock: new MockAdapter() },
      queues: ['default'] as const,
      logger: mockLogger,
      workers: [],
    })

    await expect(manager.syncSchedules([job])).rejects.toThrow(
      SchedulesNotSupportedError,
    )
    expect(await manager.syncSchedules([makeJob('Other', [])])).toBe(undefined)
  })
})
