// See https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/constructor
// for options.

import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

const prismaClient = new PrismaClient({
  log: emitLogLevels(['info', 'warn', 'error']),
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
