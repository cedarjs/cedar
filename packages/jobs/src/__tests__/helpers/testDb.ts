import fs from 'node:fs'
import path from 'node:path'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

import { PrismaClient } from '../prisma-client/client.js'

const testsDir = path.join(import.meta.dirname, '..')

/**
 * Creates a fresh SQLite database for one test file, with the tables of
 * `unit-test-schema.prisma`, and returns `count` Prisma clients connected to
 * it. Each client has its own connection, like separate processes would, so
 * tests can race them against each other.
 */
export function createTestDb(name: string, count = 2) {
  const file = path.join(testsDir, `for_unit_test.${name}.db`)

  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    fs.rmSync(file + suffix, { force: true })
  }

  const sql = fs.readFileSync(
    path.join(testsDir, 'unit-test-schema.sql'),
    'utf-8',
  )
  const sqlite = new Database(file)
  sqlite.exec(sql)
  sqlite.close()

  return Array.from(
    { length: count },
    () =>
      new PrismaClient({
        // `timeout` makes a connection wait for another one's write lock
        // instead of failing straight away with SQLITE_BUSY
        adapter: new PrismaBetterSqlite3({
          url: `file:${file}`,
          timeout: 5000,
        }),
      }),
  )
}
