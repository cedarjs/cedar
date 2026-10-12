// Pausing and resuming declared schedules, run through the JobManager and the
// PrismaAdapter against a real (SQLite) database

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '../../__tests__/helpers/testDb.js'
import {
  KeyColumnMissingError,
  PausedAtColumnMissingError,
} from '../../adapters/PrismaAdapter/errors.js'
import type { PrismaJob } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import {
  ScheduleNotFoundError,
  SchedulePausingNotSupportedError,
} from '../../errors.js'
import type { Job, JobSchedule, QueueNames } from '../../types.js'
import { nextCronRunAt } from '../../util.js'
import { JobManager } from '../JobManager.js'

import { MockAdapter, mockLogger } from './mocks.js'

const [db] = createTestDb('pauseSchedules', 1)

afterAll(async () => {
  await db.$disconnect()
})

const managerFor = (model?: string) =>
  new JobManager({
    adapters: {
      prisma: new PrismaAdapter({ db, model, logger: mockLogger }),
    },
    queues: ['default'] as const,
    logger: mockLogger,
    workers: [],
  })

const jobs = managerFor()
const adapter = jobs.adapters.prisma

type AnyJob = Job<QueueNames, any[]>

/** A job as the build makes it: `createJob()` plus its `name` and `path` */
const makeJob = (name: string, schedules: readonly JobSchedule<any[]>[]) =>
  Object.assign(
    jobs.createJob({
      queue: 'default',
      schedules,
      perform: async (..._args: unknown[]) => {},
    }),
    { name, path: `${name}/${name}` },
  ) as AnyJob

const ReportJob = makeJob('ReportJob', [
  { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
  { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
])
const CleanupJob = makeJob('CleanupJob', [{ cron: '17 * * * *' }])

const NIGHTLY = 'cedar:schedule:ReportJob:nightly'
const HOURLY = 'cedar:schedule:ReportJob:hourly'

const stored = (key: string) => db.backgroundJob.findFirst({ where: { key } })

const findJob = (processName = 'worker.0') =>
  adapter.find({ processName, maxRuntime: 60, queues: ['default'] })

/** Makes every stored job due right now */
const makeAllDue = () =>
  db.backgroundJob.updateMany({ data: { runAt: new Date(Date.now() - 1000) } })

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
  await db.unpausableBackgroundJob.deleteMany()
  await db.legacyBackgroundJob.deleteMany()
  vi.mocked(mockLogger.info).mockClear()
  vi.mocked(mockLogger.warn).mockClear()
  await jobs.syncSchedules([ReportJob, CleanupJob])
})

describe('a paused schedule', () => {
  it('is not picked up by workers', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')
    await makeAllDue()

    const picked: (string | null | undefined)[] = []
    let job: PrismaJob | undefined

    // Each find as its own worker: a worker would get its own locked jobs
    // back
    while ((job = await findJob(`worker.${picked.length}`))) {
      picked.push(job.key)
    }

    expect(picked.sort()).toEqual(['cedar:schedule:CleanupJob:default', HOURLY])
    expect((await stored(NIGHTLY))?.lockedAt).toBeNull()
  })

  it('is not picked up again by the worker that had it locked', async () => {
    await makeAllDue()
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })
    const running = await findJob('worker.0')
    expect(running?.key).toBe(NIGHTLY)

    await jobs.pauseSchedule(ReportJob, 'nightly')

    // The same process name after a restart can reclaim its own locks, but
    // not a paused job's
    expect(await findJob('worker.0')).toBeUndefined()
  })

  it('lets a run in progress finish, and its next run stays paused', async () => {
    await makeAllDue()
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })
    const running = await findJob()
    expect(running?.key).toBe(NIGHTLY)

    await jobs.pauseSchedule(ReportJob, 'nightly')

    // The worker reschedules the recurring job after the run, like
    // `Executor` does
    const runAt = nextCronRunAt('0 3 * * *')
    await adapter.success({ job: running!, runAt })

    const row = await stored(NIGHTLY)
    expect(row).toMatchObject({ lockedAt: null, runAt, attempts: 0 })
    expect(row?.pausedAt).toBeInstanceOf(Date)

    await makeAllDue()
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })
    expect(await findJob()).toBeUndefined()
  })

  it('stays paused when a run in progress fails and is retried', async () => {
    await makeAllDue()
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })
    const running = await findJob()
    await jobs.pauseSchedule(ReportJob, 'nightly')

    await adapter.error({
      job: running!,
      runAt: new Date(Date.now() - 1000),
      error: new Error('Broken'),
    })

    expect((await stored(NIGHTLY))?.pausedAt).toBeInstanceOf(Date)
    expect(await findJob()).toBeUndefined()
  })

  it('stays paused through syncs, which list it', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')
    const { pausedAt } = (await stored(NIGHTLY))!

    const result = await jobs.syncSchedules([ReportJob, CleanupJob])

    expect(result?.paused).toEqual([NIGHTLY])
    expect(result?.unchanged).toContain(NIGHTLY)
    expect((await stored(NIGHTLY))?.pausedAt).toEqual(pausedAt)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Paused declared schedules.*ReportJob:nightly.*yarn cedar jobs resume ReportJob:nightly/,
      ),
    )
  })

  it('gets a changed cron and args from a sync and stays paused', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')
    const { pausedAt } = (await stored(NIGHTLY))!

    const ChangedReportJob = makeJob('ReportJob', [
      { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
      { key: 'nightly', cron: '30 4 * * *', args: ['everything'] },
    ])
    const result = await jobs.syncSchedules([ChangedReportJob, CleanupJob])

    expect(result?.updated).toEqual([NIGHTLY])
    const row = await stored(NIGHTLY)
    expect(row).toMatchObject({ cron: '30 4 * * *', pausedAt })
    expect(JSON.parse(row!.handler).args).toEqual(['everything'])
  })

  it('is removed by a sync when it is no longer declared', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')

    const result = await jobs.syncSchedules([
      makeJob('ReportJob', [{ key: 'hourly', cron: '0 * * * *' }]),
      CleanupJob,
    ])

    expect(result?.removed).toEqual([NIGHTLY])
    expect(result?.paused).toEqual([])
    expect(await stored(NIGHTLY)).toBeNull()
  })
})

describe('pauseSchedule()', () => {
  it('pauses only the given schedule and says so', async () => {
    const result = await jobs.pauseSchedule(ReportJob, 'nightly')

    expect(result).toEqual({
      key: NIGHTLY,
      alreadyPaused: false,
      pausedAt: expect.any(Date),
    })
    expect((await stored(NIGHTLY))?.pausedAt).toEqual(result.pausedAt)
    expect((await stored(HOURLY))?.pausedAt).toBeNull()
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[CedarJS Jobs] Paused schedule ReportJob:nightly',
    )
  })

  it('changes nothing for a schedule that is paused already', async () => {
    const first = await jobs.pauseSchedule(ReportJob, 'nightly')
    const second = await jobs.pauseSchedule(ReportJob, 'nightly')

    expect(second).toEqual({
      key: NIGHTLY,
      alreadyPaused: true,
      pausedAt: first.pausedAt,
    })
  })

  it("defaults to the job's only schedule", async () => {
    const result = await jobs.pauseSchedule(CleanupJob)

    expect(result.key).toBe('cedar:schedule:CleanupJob:default')
    expect(await jobs.pauseSchedule(CleanupJob, 'default')).toMatchObject({
      alreadyPaused: true,
    })
  })

  it("defaults to the job's only schedule when that has a key", async () => {
    const NightlyJob = makeJob('NightlyJob', [
      { key: 'night', cron: '0 1 * * *' },
    ])
    await jobs.syncSchedules([ReportJob, CleanupJob, NightlyJob])

    expect((await jobs.pauseSchedule(NightlyJob)).key).toBe(
      'cedar:schedule:NightlyJob:night',
    )
  })
})

describe('resumeSchedule()', () => {
  it('schedules the next run at the next cron match from now', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')
    // The schedule missed runs while it was paused
    await db.backgroundJob.updateMany({
      where: { key: NIGHTLY },
      data: { runAt: new Date(Date.now() - 3 * 86_400_000), attempts: 3 },
    })

    const result = await jobs.resumeSchedule(ReportJob, 'nightly')

    const runAt = nextCronRunAt('0 3 * * *')
    expect(result).toEqual({ key: NIGHTLY, wasPaused: true, runAt })
    expect(await stored(NIGHTLY)).toMatchObject({
      pausedAt: null,
      runAt,
      attempts: 0,
    })
    expect(mockLogger.info).toHaveBeenCalledWith(
      `[CedarJS Jobs] Resumed schedule ReportJob:nightly, next run at ` +
        runAt.toISOString(),
    )

    // The missed runs aren't made up for
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })
    expect(await findJob()).toBeUndefined()
  })

  it('lets workers pick the schedule up again once it is due', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')
    await jobs.resumeSchedule(ReportJob, 'nightly')
    await db.backgroundJob.updateMany({
      where: { key: NIGHTLY },
      data: { runAt: new Date(Date.now() - 1000) },
    })
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })

    expect((await findJob())?.key).toBe(NIGHTLY)
  })

  it("keeps a running job's claim, so the run can still finish", async () => {
    await makeAllDue()
    await db.backgroundJob.updateMany({
      where: { key: { not: NIGHTLY } },
      data: { runAt: new Date(Date.now() + 60_000) },
    })
    const running = await findJob()
    await jobs.pauseSchedule(ReportJob, 'nightly')

    await jobs.resumeSchedule(ReportJob, 'nightly')
    expect((await stored(NIGHTLY))?.attempts).toBe(1)

    const runAt = nextCronRunAt('0 3 * * *')
    await adapter.success({ job: running!, runAt })
    expect(await stored(NIGHTLY)).toMatchObject({
      lockedAt: null,
      lockedBy: null,
      pausedAt: null,
      runAt,
      attempts: 0,
    })
  })

  it('changes nothing for a schedule that is not paused', async () => {
    const before = await stored(NIGHTLY)

    const result = await jobs.resumeSchedule(ReportJob, 'nightly')

    expect(result).toEqual({
      key: NIGHTLY,
      wasPaused: false,
      runAt: before?.runAt,
    })
    expect(await stored(NIGHTLY)).toEqual(before)
  })
})

describe('listSchedules()', () => {
  it('lists the stored schedules with their state', async () => {
    await jobs.pauseSchedule(ReportJob, 'nightly')

    const schedules = await jobs.listSchedules()

    expect(schedules).toEqual([
      expect.objectContaining({
        key: 'cedar:schedule:CleanupJob:default',
        jobName: 'CleanupJob',
        scheduleKey: 'default',
        cron: '17 * * * *',
        runAt: nextCronRunAt('17 * * * *'),
        pausedAt: null,
        running: false,
      }),
      expect.objectContaining({
        key: HOURLY,
        jobName: 'ReportJob',
        scheduleKey: 'hourly',
        pausedAt: null,
      }),
      expect.objectContaining({
        key: NIGHTLY,
        jobName: 'ReportJob',
        scheduleKey: 'nightly',
        pausedAt: expect.any(Date),
      }),
    ])
  })
})

describe('errors', () => {
  it('names the schedules when the key is unknown', async () => {
    await expect(jobs.pauseSchedule(ReportJob, 'weekly')).rejects.toThrow(
      new ScheduleNotFoundError(
        'ReportJob declares no schedule with the key `weekly` (its ' +
          'schedules: hourly, nightly)',
      ),
    )
    await expect(jobs.resumeSchedule(ReportJob, 'weekly')).rejects.toThrow(
      ScheduleNotFoundError,
    )
  })

  it('needs the key when the job has several schedules', async () => {
    await expect(jobs.pauseSchedule(ReportJob)).rejects.toThrow(
      /ReportJob declares 2 schedules \(hourly, nightly\), so say which one/,
    )
  })

  it('rejects a job without schedules', async () => {
    const PlainJob = makeJob('PlainJob', [])

    await expect(jobs.pauseSchedule(PlainJob)).rejects.toThrow(
      new ScheduleNotFoundError('PlainJob declares no schedules'),
    )
  })

  it('explains a declared schedule that is not stored', async () => {
    const NewJob = makeJob('NewJob', [{ cron: '0 1 * * *' }])

    await expect(jobs.pauseSchedule(NewJob)).rejects.toThrow(
      /NewJob:default is declared but not stored.*start \(or restart\) them/,
    )
    await expect(jobs.resumeSchedule(NewJob)).rejects.toThrow(
      ScheduleNotFoundError,
    )
  })

  it('needs an adapter that can pause schedules', async () => {
    const manager = new JobManager({
      adapters: { mock: new MockAdapter() },
      queues: ['default'] as const,
      logger: mockLogger,
      workers: [],
    })

    await expect(manager.pauseSchedule(CleanupJob)).rejects.toThrow(
      new SchedulePausingNotSupportedError('mock', 'pauseSchedule'),
    )
    await expect(manager.resumeSchedule(CleanupJob)).rejects.toThrow(
      new SchedulePausingNotSupportedError('mock', 'resumeSchedule'),
    )
    await expect(manager.listSchedules()).rejects.toThrow(
      SchedulePausingNotSupportedError,
    )
  })

  it('uses the adapter named by `scheduleAdapter`', async () => {
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

    await manager.pauseSchedule(CleanupJob)

    expect(
      (await stored('cedar:schedule:CleanupJob:default'))?.pausedAt,
    ).toBeInstanceOf(Date)
  })
})

describe('a model without a `pausedAt` column', () => {
  const unpausable = managerFor('unpausableBackgroundJob')

  beforeEach(async () => {
    await unpausable.syncSchedules([ReportJob, CleanupJob])
  })

  it('syncs and runs declared schedules', async () => {
    const result = await unpausable.syncSchedules([ReportJob, CleanupJob])
    expect(result?.paused).toEqual([])

    await db.unpausableBackgroundJob.updateMany({
      data: { runAt: new Date(Date.now() - 1000) },
    })
    const job = await unpausable.adapters.prisma.find({
      processName: 'worker.0',
      maxRuntime: 60,
      queues: ['default'],
    })
    expect(job?.key).toMatch(/^cedar:schedule:/)
    expect(job).not.toHaveProperty('pausedAt')
  })

  it('explains the missing column when pausing or resuming', async () => {
    await expect(
      unpausable.pauseSchedule(ReportJob, 'nightly'),
    ).rejects.toThrow(PausedAtColumnMissingError)
    await expect(
      unpausable.resumeSchedule(ReportJob, 'nightly'),
    ).rejects.toThrow(/Add `pausedAt DateTime\?` to the model/)
  })

  it('lists schedules as not paused', async () => {
    const schedules = await unpausable.listSchedules()

    expect(schedules).toHaveLength(3)
    expect(schedules.every((schedule) => schedule.pausedAt === null)).toBe(true)
  })
})

describe('a model without `key` and `pausedAt` columns', () => {
  const legacy = managerFor('legacyBackgroundJob')

  it('explains the missing column when pausing', async () => {
    await expect(legacy.pauseSchedule(CleanupJob)).rejects.toThrow(
      KeyColumnMissingError,
    )
  })

  it('has no schedules to list', async () => {
    expect(await legacy.listSchedules()).toEqual([])
  })
})
