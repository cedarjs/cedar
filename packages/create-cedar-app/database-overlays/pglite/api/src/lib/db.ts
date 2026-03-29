import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'
import { getPaths } from '@cedarjs/project-config'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

const pgDataDir = path.join(getPaths().api.base, 'db', 'pglite-data')
const pglite = await PGlite.create(pgDataDir)
const pgliteServer = new PGLiteSocketServer({
  db: pglite,
  port: 5433,
  host: '127.0.0.1',
})
await pgliteServer.start()

const adapter = new PrismaPg({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres',
})
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
