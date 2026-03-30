import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'
import { getPaths } from '@cedarjs/project-config'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

const url = new URL(process.env.DATABASE_URL)
const pgDataDir = path.join(getPaths().api.base, 'db', 'pglite-data')

const pglite = await PGlite.create(pgDataDir)
const pgliteServer = new PGLiteSocketServer({
  db: pglite,
  port: parseInt(url.port, 10),
  host: url.hostname,
})

await pgliteServer.start()

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
