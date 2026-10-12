// `cedar jobs pause`, `resume` and `list`, against a real (SQLite) database

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '../../__tests__/helpers/testDb.js'
import { PrismaAdapter } from '../../adapters/PrismaAdapter/PrismaAdapter.js'
import { mockLogger } from '../../core/__tests__/mocks.js'
import { JobManager } from '../../core/JobManager.js'
import { JobIdNotFoundError } from '../../errors.js'
import { nextCronRunAt } from '../../util.js'
import { parseArgs, parseJobId, runPauseCommand } from '../cedar-jobs.js'

vi.mock('@cedarjs/cli-helpers/loadEnvFiles', () => {
  return {
    loadEnvFiles: () => {},
  }
})

const [db] = createTestDb('cedarJobsPause', 1)

afterAll(async () => {
  await db.$disconnect()
})

const manager = new JobManager({
  adapters: { prisma: new PrismaAdapter({ db, logger: mockLogger }) },
  queues: ['default'] as const,
  logger: mockLogger,
  workers: [],
})
const later = manager.createScheduler({ adapter: 'prisma' })

const ReportJob = Object.assign(
  manager.createJob({ queue: 'default', perform: async () => {} }),
  { name: 'ReportJob', path: 'ReportJob/ReportJob' },
)

const run = (
  command: 'pause' | 'resume' | 'list',
  id?: string | number,
  limit?: number,
) => runPauseCommand({ command, id, limit, manager })

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
})

describe('parsing the command line', () => {
  it('reads the id of pause and resume', () => {
    expect(parseArgs(['node', 'cedar-jobs.js', 'pause', '42'])).toEqual({
      command: 'pause',
      id: 42,
      adapter: undefined,
      limit: 100,
    })
    expect(
      parseArgs(['node', 'cedar-jobs.js', 'resume', '42', '--adapter', 'db']),
    ).toMatchObject({ command: 'resume', id: 42, adapter: 'db' })
  })

  it('reads list and its limit', () => {
    expect(
      parseArgs(['node', 'cedar-jobs.js', 'list', '--limit', '5']),
    ).toMatchObject({ command: 'list', id: undefined, limit: 5 })
  })

  it('keeps ids that are not numbers as strings', () => {
    expect(parseJobId('42')).toBe(42)
    expect(parseJobId(42)).toBe(42)
    expect(parseJobId('job_8f3a')).toBe('job_8f3a')
    expect(parseJobId(undefined)).toBeUndefined()
  })
})

describe('cedar jobs pause and resume', () => {
  it('pauses and resumes a job', async () => {
    const job = await later(ReportJob, { cron: '0 3 * * *' })

    expect(await run('pause', job.id)).toBe(
      `Paused job ${job.id}. It doesn't run until you resume it with ` +
        `\`yarn cedar jobs resume ${job.id}\``,
    )
    expect(await run('pause', job.id)).toMatch(
      new RegExp(`^Job ${job.id} was already paused \\(since .+\\)$`),
    )
    expect(await run('resume', job.id)).toBe(
      `Resumed job ${job.id}. Its next run is at ` +
        nextCronRunAt('0 3 * * *').toISOString(),
    )
    expect(await run('resume', job.id)).toMatch(/isn't paused/)
  })

  it('rejects an unknown id', async () => {
    await expect(run('pause', 404)).rejects.toThrow(JobIdNotFoundError)
  })

  it('needs an id', async () => {
    await expect(run('resume')).rejects.toThrow(
      'Say which job to resume by its id',
    )
  })
})

describe('cedar jobs list', () => {
  it('lists the jobs with their ids, next run or pause', async () => {
    const cron = await later(ReportJob, { cron: '0 3 * * *' })
    const once = await later(ReportJob, { wait: 60 })
    await run('pause', cron.id)
    const pausedAt = (await db.backgroundJob.findUnique({
      where: { id: cron.id },
    }))!.pausedAt!

    const lines = (await run('list')).split('\n')

    expect(lines[0]).toMatch(/^ID\s+JOB\s+QUEUE\s+CRON\s+STATUS$/)
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${once.id}\\s+ReportJob\\s+default\\s+-\\s+next run ` +
            once.runAt!.toISOString(),
        ),
      ),
      expect.stringMatching(
        new RegExp(
          `^${cron.id}\\s+ReportJob\\s+default\\s+0 3 \\* \\* \\*\\s+paused ` +
            `since ${pausedAt.toISOString()}$`,
        ),
      ),
    ])
  })

  it('says when the list was cut short', async () => {
    await later(ReportJob, { wait: 60 })
    await later(ReportJob, { wait: 61 })

    const lines = (await run('list', undefined, 1)).split('\n')

    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('(the first 1, use --limit to see more)')
  })

  it('says when there are no jobs', async () => {
    expect(await run('list')).toBe('No jobs are waiting to run')
  })
})
