// `cedar jobs pause`, `resume` and `schedules`, against a real (SQLite)
// database

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '../../__tests__/helpers/testDb.js'
import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import { mockLogger } from '../../core/__tests__/mocks.js'
import { JobManager } from '../../core/JobManager.js'
import { ScheduleNotFoundError } from '../../errors.js'
import type { Job, QueueNames } from '../../types.js'
import { nextCronRunAt } from '../../util.js'
import {
  parseArgs,
  parseScheduleArg,
  runScheduleCommand,
} from '../cedar-jobs.js'

vi.mock('@cedarjs/cli-helpers/loadEnvFiles', () => {
  return {
    loadEnvFiles: () => {},
  }
})

const [db] = createTestDb('cedarJobsSchedules', 1)

afterAll(async () => {
  await db.$disconnect()
})

const manager = new JobManager({
  adapters: { prisma: new PrismaAdapter({ db, logger: mockLogger }) },
  queues: ['default'] as const,
  logger: mockLogger,
  workers: [],
})

const named = (job: object, name: string) =>
  Object.assign(job, { name, path: `${name}/${name}` }) as Job<
    QueueNames,
    unknown[]
  >

const ReportJob = named(
  manager.createJob({
    queue: 'default',
    schedules: [
      { key: 'hourly', cron: '0 * * * *', args: ['summary'] },
      { key: 'nightly', cron: '0 3 * * *', args: ['full'] },
    ],
    perform: async (_kind: string) => {},
  }),
  'ReportJob',
)
const CleanupJob = named(
  manager.createJob({
    queue: 'default',
    schedules: [{ cron: '17 * * * *' }],
    perform: async () => {},
  }),
  'CleanupJob',
)
const PlainJob = named(
  manager.createJob({ queue: 'default', perform: async () => {} }),
  'PlainJob',
)

const loadJobs = async () => [ReportJob, CleanupJob, PlainJob]

const run = (command: 'pause' | 'resume' | 'schedules', schedule?: string) =>
  runScheduleCommand({ command, schedule, manager, loadJobs })

const pausedAtOf = async (key: string) =>
  (await db.backgroundJob.findFirst({ where: { key } }))?.pausedAt

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
  await manager.syncSchedules([ReportJob, CleanupJob, PlainJob])
})

describe('parsing the command line', () => {
  it('reads the schedule of pause and resume', () => {
    expect(
      parseArgs(['node', 'cedar-jobs.js', 'pause', 'ReportJob:nightly']),
    ).toEqual({ command: 'pause', schedule: 'ReportJob:nightly' })
    expect(
      parseArgs(['node', 'cedar-jobs.js', 'resume', 'CleanupJob']),
    ).toEqual({ command: 'resume', schedule: 'CleanupJob' })
  })

  it('reads the schedules command', () => {
    expect(parseArgs(['node', 'cedar-jobs.js', 'schedules'])).toEqual({
      command: 'schedules',
      schedule: undefined,
    })
  })

  it('splits a schedule into the job name and the key', () => {
    expect(parseScheduleArg('ReportJob:nightly')).toEqual({
      jobName: 'ReportJob',
      key: 'nightly',
    })
    expect(parseScheduleArg('ReportJob')).toEqual({
      jobName: 'ReportJob',
      key: undefined,
    })
    expect(parseScheduleArg('ReportJob:')).toEqual({
      jobName: 'ReportJob',
      key: undefined,
    })
    // Only the first `:` separates, keys may contain more
    expect(parseScheduleArg('ReportJob:eu:nightly')).toEqual({
      jobName: 'ReportJob',
      key: 'eu:nightly',
    })
  })
})

describe('cedar jobs pause', () => {
  it('pauses the schedule', async () => {
    expect(await run('pause', 'ReportJob:nightly')).toBe(
      "Paused ReportJob:nightly. It doesn't run until you resume it with " +
        '`yarn cedar jobs resume ReportJob:nightly`',
    )
    expect(await pausedAtOf('cedar:schedule:ReportJob:nightly')).toBeInstanceOf(
      Date,
    )
    expect(await pausedAtOf('cedar:schedule:ReportJob:hourly')).toBeNull()
  })

  it("pauses a job's only schedule without a key", async () => {
    await run('pause', 'CleanupJob')

    expect(
      await pausedAtOf('cedar:schedule:CleanupJob:default'),
    ).toBeInstanceOf(Date)
  })

  it('says when the schedule was paused already', async () => {
    await run('pause', 'CleanupJob')

    expect(await run('pause', 'CleanupJob:default')).toMatch(
      /^CleanupJob:default was already paused \(since .+\)$/,
    )
  })

  it('names the jobs with schedules when the job is unknown', async () => {
    await expect(run('pause', 'ReprotJob:nightly')).rejects.toThrow(
      new ScheduleNotFoundError(
        'There is no job named ReprotJob. Jobs with declared schedules: ' +
          'ReportJob, CleanupJob',
      ),
    )
  })

  it("names the job's schedules when the key is unknown", async () => {
    await expect(run('pause', 'ReportJob:weekly')).rejects.toThrow(
      /its schedules: hourly, nightly/,
    )
  })

  it('needs a schedule', async () => {
    await expect(run('pause')).rejects.toThrow(/Say which schedule to pause/)
  })
})

describe('cedar jobs resume', () => {
  it('resumes the schedule from its next cron match', async () => {
    await run('pause', 'ReportJob:nightly')

    expect(await run('resume', 'ReportJob:nightly')).toBe(
      'Resumed ReportJob:nightly. Its next run is at ' +
        nextCronRunAt('0 3 * * *').toISOString(),
    )
    expect(await pausedAtOf('cedar:schedule:ReportJob:nightly')).toBeNull()
  })

  it("says when the schedule isn't paused", async () => {
    expect(await run('resume', 'CleanupJob')).toBe(
      "CleanupJob:default isn't paused. Its next run is at " +
        nextCronRunAt('17 * * * *').toISOString(),
    )
  })
})

describe('cedar jobs schedules', () => {
  it('lists the schedules, with their next run or since when paused', async () => {
    await run('pause', 'ReportJob:nightly')
    const pausedAt = await pausedAtOf('cedar:schedule:ReportJob:nightly')

    expect((await run('schedules')).split('\n')).toEqual([
      `CleanupJob:default  17 * * * *  next run ${nextCronRunAt('17 * * * *').toISOString()}`,
      `ReportJob:hourly    0 * * * *   next run ${nextCronRunAt('0 * * * *').toISOString()}`,
      `ReportJob:nightly   0 3 * * *   paused since ${pausedAt?.toISOString()}`,
    ])
  })

  it('says when there are none', async () => {
    await db.backgroundJob.deleteMany()

    expect(await run('schedules')).toBe('No declared schedules are stored')
  })
})
