// Two workers sharing one database, run against a real (SQLite) database:
// what a worker's lock name lets it take back is decided by the queries, which
// a mocked client can't show

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDb } from '../../../__tests__/helpers/testDb.js'
import { mockLogger } from '../../../core/__tests__/mocks.js'
import { JobManager } from '../../../core/JobManager.js'
import { PrismaAdapter } from '../PrismaAdapter.js'

const [db, otherDb] = createTestDb('locks')

afterAll(async () => {
  await db.$disconnect()
  await otherDb.$disconnect()
})

const jobs = new JobManager({
  adapters: {
    prisma: new PrismaAdapter({ db, logger: mockLogger }),
  },
  queues: ['default'] as const,
  logger: mockLogger,
  workers: [],
})
const later = jobs.createScheduler({ adapter: 'prisma' })
const adapter = jobs.adapters.prisma
const otherAdapter = new PrismaAdapter({ db: otherDb, logger: mockLogger })

const AlertJob = Object.assign(
  jobs.createJob({ queue: 'default', perform: async () => {} }),
  { name: 'AlertJob', path: 'AlertJob/AlertJob' },
)

const find = (on: PrismaAdapter, processName: string) =>
  on.find({ processName, maxRuntime: 60, queues: ['default'] })

const scheduleDueJob = async () => {
  const job = await later(AlertJob, [])
  await db.backgroundJob.update({
    where: { id: job.id },
    data: { runAt: new Date(Date.now() - 1000) },
  })

  return job
}

beforeEach(async () => {
  await db.backgroundJob.deleteMany()
})

describe('two workers', () => {
  it("with their own lock names don't take a job from each other", async () => {
    const job = await scheduleDueJob()

    const running = await find(adapter, 'worker.default.0 host:a pid:1')
    expect(running?.id).toBe(job.id)
    expect(await find(otherAdapter, 'worker.default.0 host:a pid:2')).toBe(
      undefined,
    )

    await adapter.success({ job: running!, deleteJob: true })

    expect(await db.backgroundJob.count()).toBe(0)
  })

  it('sharing a lock name both take the same job', async () => {
    const job = await scheduleDueJob()

    const first = await find(adapter, 'worker.default.0')
    const second = await find(otherAdapter, 'worker.default.0')
    expect(first?.id).toBe(job.id)
    expect(second?.id).toBe(job.id)

    // The first run's result doesn't match the second claim, so the job stays
    // locked by the shared name, for either worker to run again
    await adapter.success({ job: first!, deleteJob: true })

    expect(await db.backgroundJob.count()).toBe(1)
    expect((await find(adapter, 'worker.default.0'))?.id).toBe(job.id)
  })
})
