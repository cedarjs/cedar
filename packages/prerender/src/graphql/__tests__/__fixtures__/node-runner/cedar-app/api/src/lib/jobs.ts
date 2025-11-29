// Setup for background jobs. Jobs themselves live in api/src/jobs
// Execute jobs in dev with `yarn cedar jobs work`
// See https://cedarjs.com/docs/background-jobs

import { PrismaAdapter, JobManager } from '@cedarjs/jobs'

import { db } from 'src/lib/db.js'
import { logger } from 'src/lib/logger.js'

export const jobs = new JobManager({
  adapters: {
    prisma: new PrismaAdapter({ db, logger }),
  },
  queues: ['default'] as const,
  logger,
  workers: [
    {
      adapter: 'prisma',
      logger,
      queue: '*', // watch all queues
      count: 1,
      maxAttempts: 24,
      maxRuntime: 14_400,
      deleteFailedJobs: false,
      sleepDelay: 5,
    },
  ],
})

export const later = jobs.createScheduler({
  adapter: 'prisma',
})
