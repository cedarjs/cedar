import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Run `yarn cedar dev` / `yarn cedar test` with ' +
      'CEDAR_PG=1 so cedar-pg can provision a worktree-scoped database, or set ' +
      'DATABASE_URL manually.'
  )
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prismaClient = new PrismaClient({
  log: emitLogLevels(['info', 'warn', 'error']),
  adapter,
})

handlePrismaLogging({
  db: prismaClient,
  logger,
  logLevels: ['info', 'warn', 'error'],
})

/**
 * Global Prisma client extensions should be added here, as $extend
 * returns a new instance.
 * export const db = prismaClient.$extend(...)
 * Add any .$on hooks before using $extend
 */
export const db = prismaClient
