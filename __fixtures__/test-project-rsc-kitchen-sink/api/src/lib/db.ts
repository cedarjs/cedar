// See https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/constructor
// for options.

import path from 'node:path'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

// `import.meta.dirname` is available in ESM (e.g. when bundled by Vite for RSC/SSR),
// while `__dirname` is available in CJS (e.g. when compiled by the API build).
const currentDir: string =
  typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : __dirname
const apiDir = path.resolve(currentDir, '../..')

const resolveSqliteUrl = (url = 'file:./db/dev.db') => {
  if (!url.startsWith('file:.')) {
    return url
  }

  return `file:${path.resolve(apiDir, url.slice('file:'.length))}`
}

const adapter = new PrismaBetterSqlite3({
  url: resolveSqliteUrl(process.env.DATABASE_URL),
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
