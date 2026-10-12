// Pausing and resuming jobs by id, run through the JobManager and the
// PrismaAdapter against a real (SQLite) database

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '../../__tests__/helpers/testDb.js'
import { PausedAtColumnMissingError } from '../../adapters/PrismaAdapter/errors.js'
import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import {
  AdapterNameRequiredError,
  JobIdNotFoundError,
  JobNotActiveError,
  PauseNotImplementedError,
} from '../../errors.js'
import { nextCronRunAt } from '../../util.js'
import { JobManager } from '../JobManager.js'

import { MockAdapter, mockLogger } from './mocks.js'

const [db] = createTestDb('pauseJobs', 1)

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
const later = jobs.createScheduler({ adapter: 'prisma' })
const adapter = jobs.adapters.prisma

/** What the build adds to every job: its name and path */
const named = <TJob extends object>(job: TJob, name: string) =>
  Object.assign(job, { name, path: `${name}/${name}` })

const ReportJob = named(
  jobs.createJob({ queue: 'default', perform: async () => {} }),
  'ReportJob',
)
const EmailJob = named(
  jobs.createJob({ queue: 'default', perform: async (_to: string) => {} }),
  'EmailJob',
)

const NIGHTLY = '0 3 * * *'

const findJob = (processName = 'worker.0') =>
  adapter.find({ processName, maxRuntime: 60, queues: ['default'] })

const row = (id: number) => db.backgroundJob.findUnique({ where: { id } })

/** Makes the job due right now */
const makeDue = (id: number) =>
  db.backgroundJob.update({
    where: { id },
    data: { runAt: new Date(Date.now() - 1000) },
  })

/** A recurring job that's due, and running on a worker */
const runningCronJob = async () => {
  const job = await later(ReportJob, { cron: NIGHTLY })
  await makeDue(job.id)
  const running = await findJob()
  expect(running?.id).toBe(job.id)

  return running!
}

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
  await db.legacyBackgroundJob.deleteMany()
  vi.mocked(mockLogger.info).mockClear()
})

describe('a paused job', () => {
  it('is not picked up by workers', async () => {
    const paused = await later(EmailJob, ['a@example.com'])
    const other = await later(EmailJob, ['b@example.com'])
    await jobs.pauseJob(paused.id)

    expect((await findJob('worker.0'))?.id).toBe(other.id)
    expect(await findJob('worker.1')).toBeUndefined()
    expect((await row(paused.id))?.lockedAt).toBeNull()
  })

  it('is not picked up again by the worker that had it locked', async () => {
    const running = await runningCronJob()

    await jobs.pauseJob(running.id)

    // A worker with the same process name, after a restart, can reclaim its
    // own locks, but not a paused job's
    expect(await findJob('worker.0')).toBeUndefined()
  })

  it('finishes a run in progress, and the next run of a recurring job stays paused', async () => {
    const running = await runningCronJob()
    await jobs.pauseJob(running.id)

    // The worker reschedules the recurring job after the run, like
    // `Executor` does
    const runAt = nextCronRunAt(NIGHTLY)
    await adapter.success({ job: running, runAt })

    const stored = await row(running.id)
    expect(stored).toMatchObject({ lockedAt: null, runAt, attempts: 0 })
    expect(stored?.pausedAt).toBeInstanceOf(Date)

    await makeDue(running.id)
    expect(await findJob('worker.1')).toBeUndefined()
  })

  it('stays paused when a run in progress fails and is retried', async () => {
    const running = await runningCronJob()
    await jobs.pauseJob(running.id)

    await adapter.error({
      job: running,
      runAt: new Date(Date.now() - 1000),
      error: new Error('Broken'),
    })

    expect((await row(running.id))?.pausedAt).toBeInstanceOf(Date)
    expect(await findJob('worker.1')).toBeUndefined()
  })
})

describe('pauseJob()', () => {
  it('pauses the job and says so', async () => {
    const job = await later(EmailJob, ['a@example.com'], { wait: 60 })

    const result = await jobs.pauseJob(job.id)

    expect(result).toEqual({ alreadyPaused: false, pausedAt: expect.any(Date) })
    expect((await row(job.id))?.pausedAt).toEqual(result.pausedAt)
    expect(mockLogger.info).toHaveBeenCalledWith(
      `[CedarJS Jobs] Paused job ${job.id}`,
    )
  })

  it('changes nothing for a job that is paused already', async () => {
    const job = await later(ReportJob, { cron: NIGHTLY })
    const first = await jobs.pauseJob(job.id)

    expect(await jobs.pauseJob(job.id)).toEqual({
      alreadyPaused: true,
      pausedAt: first.pausedAt,
    })
  })

  it('pauses a job that is waiting to be retried', async () => {
    const job = await later(EmailJob, ['a@example.com'])
    const running = await findJob()
    await adapter.error({
      job: running!,
      runAt: new Date(Date.now() - 1000),
      error: new Error('Broken'),
    })

    await jobs.pauseJob(job.id)

    expect(await findJob('worker.1')).toBeUndefined()
  })
})

describe('resumeJob()', () => {
  it("runs a recurring job next at its cron's next match from now", async () => {
    const job = await later(ReportJob, { cron: NIGHTLY })
    await jobs.pauseJob(job.id)
    // Runs were missed while it was paused, and it had failed attempts
    await db.backgroundJob.update({
      where: { id: job.id },
      data: { runAt: new Date(Date.now() - 3 * 86_400_000), attempts: 3 },
    })

    const result = await jobs.resumeJob(job.id)

    const runAt = nextCronRunAt(NIGHTLY)
    expect(result).toEqual({ wasPaused: true, runAt })
    expect(await row(job.id)).toMatchObject({
      pausedAt: null,
      runAt,
      attempts: 0,
    })
    expect(mockLogger.info).toHaveBeenCalledWith(
      `[CedarJS Jobs] Resumed job ${job.id}, next run at ${runAt.toISOString()}`,
    )

    // The missed runs aren't made up for
    expect(await findJob()).toBeUndefined()
  })

  it('keeps the run time of a one-off job that is still in the future', async () => {
    const job = await later(EmailJob, ['a@example.com'], { wait: 3600 })
    await jobs.pauseJob(job.id)

    const result = await jobs.resumeJob(job.id)

    expect(result).toEqual({ wasPaused: true, runAt: job.runAt })
    expect((await row(job.id))?.runAt).toEqual(job.runAt)
    expect(await findJob()).toBeUndefined()
  })

  it('runs a one-off job whose run time passed while it was paused right away', async () => {
    const job = await later(EmailJob, ['a@example.com'], { wait: 1 })
    await jobs.pauseJob(job.id)
    await makeDue(job.id)
    expect(await findJob()).toBeUndefined()

    await jobs.resumeJob(job.id)

    expect((await findJob())?.id).toBe(job.id)
  })

  it("keeps a running job's claim, so its run can still finish", async () => {
    const running = await runningCronJob()
    await jobs.pauseJob(running.id)

    await jobs.resumeJob(running.id)
    expect((await row(running.id))?.attempts).toBe(1)

    const runAt = nextCronRunAt(NIGHTLY)
    await adapter.success({ job: running, runAt })
    expect(await row(running.id)).toMatchObject({
      lockedAt: null,
      lockedBy: null,
      pausedAt: null,
      runAt,
      attempts: 0,
    })
  })

  it('changes nothing for a job that is not paused', async () => {
    const job = await later(ReportJob, { cron: NIGHTLY })
    const before = await row(job.id)

    expect(await jobs.resumeJob(job.id)).toEqual({
      wasPaused: false,
      runAt: before?.runAt,
    })
    expect(await row(job.id)).toEqual(before)
  })
})

describe('listJobs()', () => {
  it('lists the jobs waiting to run, running or paused, next first', async () => {
    const later1 = await later(EmailJob, ['a@example.com'], { wait: 600 })
    const sooner = await later(EmailJob, ['b@example.com'], { wait: 60 })
    const cron = await later(ReportJob, { cron: NIGHTLY })
    await jobs.pauseJob(later1.id)

    const cancelled = await later(EmailJob, ['c@example.com'], { wait: 30 })
    await later.cancel(cancelled.id)

    expect(await jobs.listJobs()).toEqual([
      {
        id: sooner.id,
        name: 'EmailJob',
        queue: 'default',
        cron: null,
        runAt: sooner.runAt,
        pausedAt: null,
        running: false,
        attempts: 0,
      },
      expect.objectContaining({ id: later1.id, pausedAt: expect.any(Date) }),
      expect.objectContaining({
        id: cron.id,
        name: 'ReportJob',
        cron: NIGHTLY,
        runAt: nextCronRunAt(NIGHTLY),
      }),
    ])
  })

  it('lists at most `limit` jobs', async () => {
    for (let i = 0; i < 3; i++) {
      await later(EmailJob, [`${i}@example.com`], { wait: 60 + i })
    }

    expect(await jobs.listJobs({ limit: 2 })).toHaveLength(2)
  })

  it('leaves out completed jobs', async () => {
    const job = await later(EmailJob, ['a@example.com'])
    const running = await findJob()
    await adapter.success({ job: running!, runAt: undefined })

    expect(await row(job.id)).not.toBeNull()
    expect(await jobs.listJobs()).toEqual([])
  })
})

describe('errors', () => {
  it('rejects an unknown id', async () => {
    await expect(jobs.pauseJob(12345)).rejects.toThrow(
      new JobIdNotFoundError(12345),
    )
    await expect(jobs.resumeJob(12345)).rejects.toThrow(JobIdNotFoundError)
  })

  it('rejects a job that failed for good or was cancelled', async () => {
    const job = await later(EmailJob, ['a@example.com'])
    await later.cancel(job.id)

    await expect(jobs.pauseJob(job.id)).rejects.toThrow(
      new JobNotActiveError(job.id, 'failed'),
    )
    await expect(jobs.resumeJob(job.id)).rejects.toThrow(JobNotActiveError)
  })

  it('rejects a completed job', async () => {
    const job = await later(EmailJob, ['a@example.com'])
    const running = await findJob()
    await adapter.success({ job: running!, runAt: undefined })

    await expect(jobs.pauseJob(job.id)).rejects.toThrow(
      new JobNotActiveError(job.id, 'completed'),
    )
  })

  it('needs an adapter that can pause jobs', async () => {
    const manager = new JobManager({
      adapters: { mock: new MockAdapter() },
      queues: ['default'] as const,
      logger: mockLogger,
      workers: [],
    })

    await expect(manager.pauseJob(1)).rejects.toThrow(
      new PauseNotImplementedError('pause'),
    )
    await expect(manager.resumeJob(1)).rejects.toThrow(
      new PauseNotImplementedError('resume'),
    )
    await expect(manager.listJobs()).rejects.toThrow(
      new PauseNotImplementedError('list'),
    )
  })

  it('needs the adapter named when there are several', async () => {
    const manager = new JobManager({
      adapters: {
        mock: new MockAdapter(),
        prisma: new PrismaAdapter({ db, logger: mockLogger }),
      },
      queues: ['default'] as const,
      logger: mockLogger,
      workers: [],
    })
    const job = await later(EmailJob, ['a@example.com'], { wait: 60 })

    await expect(manager.pauseJob(job.id)).rejects.toThrow(
      new AdapterNameRequiredError(['mock', 'prisma']),
    )

    await manager.pauseJob(job.id, { adapter: 'prisma' })
    expect((await row(job.id))?.pausedAt).toBeInstanceOf(Date)
  })
})

describe('a model without a `pausedAt` column', () => {
  const legacy = managerFor('legacyBackgroundJob')
  const legacyLater = legacy.createScheduler({ adapter: 'prisma' })
  const legacyAdapter = legacy.adapters.prisma

  it('schedules and runs jobs', async () => {
    const job = await legacyLater(EmailJob, ['a@example.com'])

    const running = await legacyAdapter.find({
      processName: 'worker.0',
      maxRuntime: 60,
      queues: ['default'],
    })

    expect(running?.id).toBe(job.id)
    expect(running).not.toHaveProperty('pausedAt')
  })

  it('explains the missing column when pausing or resuming', async () => {
    const job = await legacyLater(EmailJob, ['a@example.com'])

    await expect(legacy.pauseJob(job.id)).rejects.toThrow(
      PausedAtColumnMissingError,
    )
    await expect(legacy.resumeJob(job.id)).rejects.toThrow(
      /Add `pausedAt DateTime\?` to the model.*yarn cedar prisma migrate dev/,
    )
  })

  it('lists jobs as not paused', async () => {
    const job = await legacyLater(EmailJob, ['a@example.com'])

    expect(await legacy.listJobs()).toEqual([
      expect.objectContaining({ id: job.id, pausedAt: null }),
    ])
  })
})
