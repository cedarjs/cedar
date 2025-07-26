import fs from 'fs'
import path from 'path'

import type { PrismaClient } from '@prisma/client'
import { bundleRequire } from 'bundle-require'
import { Listr } from 'listr2'

import { getPaths, resolveFile } from '@cedarjs/project-config'

import c from '../lib/colors'
import type { DataMigrateUpOptions, DataMigration } from '../types'

export async function handler({
  importDbClientFromDist,
  distPath,
}: DataMigrateUpOptions) {
  let db: any

  if (importDbClientFromDist) {
    if (!fs.existsSync(distPath)) {
      console.warn(
        `Can't find api dist at ${distPath}. You may need to build first: ` +
          'yarn rw build api',
      )
      process.exitCode = 1
      return
    }

    const distLibPath = path.join(distPath, 'lib')
    const distLibDbPath = path.join(distLibPath, 'db.js')

    if (!fs.existsSync(distLibDbPath)) {
      console.error(
        `Can't find db.js at ${distLibDbPath}. CedarJS expects the db.js ` +
          `file to be in the ${distLibPath} directory`,
      )
      process.exitCode = 1
      return
    }

    db = (await import(distLibDbPath)).db
  } else {
    const dbPath = resolveFile(path.join(getPaths().api.lib, 'db'))

    if (!dbPath) {
      console.error(`Can't find your db file in ${getPaths().api.lib}`)
      process.exitCode = 1
      return
    }

    // Needed plugins:
    // - babel-plugin-module-resolver: 'src' -> './src' etc
    // - rwjs-babel-directory-named-modules: 'src/services/userExamples' -> './src/services/userExamples/userExamples.ts'
    // - babel-plugin-auto-import: `import { gql } from 'graphql-tag`, `import { context } from '@cedarjs/context`
    // - babel-plugin-graphql-tag: ???
    // - rwjs-babel-glob-import-dir: Handle imports like src/services/**/*.{js,ts}
    // - rwjs-babel-otel-wrapping: Wrap code in OpenTelemetry spans
    const { mod } = await bundleRequire({
      filepath: dbPath,
      // TODO: Add plugins
    })

    db = mod.db
  }

  const pendingDataMigrations = await getPendingDataMigrations(db)

  if (!pendingDataMigrations.length) {
    console.info(c.success(`\n${NO_PENDING_MIGRATIONS_MESSAGE}\n`))
    process.exitCode = 0
    return
  }

  const counters = { run: 0, skipped: 0, error: 0 }

  const dataMigrationTasks = pendingDataMigrations.map((dataMigration) => {
    const dataMigrationName = path.basename(dataMigration.path, '.js')

    return {
      title: dataMigrationName,
      skip() {
        if (counters.error > 0) {
          counters.skipped++
          return true
        } else {
          return false
        }
      },
      async task() {
        try {
          const { startedAt, finishedAt } = await runDataMigration(
            db,
            dataMigration.path,
          )
          counters.run++
          await recordDataMigration(db, {
            version: dataMigration.version,
            name: dataMigrationName,
            startedAt,
            finishedAt,
          })
        } catch (e) {
          counters.error++
          console.error(
            c.error(`Error in data migration: ${(e as Error).message}`),
          )
        }
      },
    }
  })

  const tasks = new Listr(dataMigrationTasks, {
    renderer: 'verbose',
  })

  try {
    await tasks.run()
    await db.$disconnect()

    console.log()
    reportDataMigrations(counters)
    console.log()

    if (counters.error) {
      process.exitCode = 1
    }
  } catch {
    process.exitCode = 1
    await db.$disconnect()

    console.log()
    reportDataMigrations(counters)
    console.log()
  }
}

/**
 * Return the list of migrations that haven't run against the database yet
 */
async function getPendingDataMigrations(db: PrismaClient) {
  const dataMigrationsPath = getPaths().api.dataMigrations

  if (!fs.existsSync(dataMigrationsPath)) {
    return []
  }

  const dataMigrations = fs
    .readdirSync(dataMigrationsPath)
    // There may be a `.keep` file in the data migrations directory.
    .filter((dataMigrationFileName) =>
      ['js', '.ts'].some((extension) =>
        dataMigrationFileName.endsWith(extension),
      ),
    )
    .map((dataMigrationFileName) => {
      const [version] = dataMigrationFileName.split('-')

      return {
        version,
        path: path.join(dataMigrationsPath, dataMigrationFileName),
      }
    })

  const ranDataMigrations: DataMigration[] = await db.rW_DataMigration.findMany(
    {
      orderBy: { version: 'asc' },
    },
  )
  const ranDataMigrationVersions = ranDataMigrations.map((dataMigration) =>
    dataMigration.version.toString(),
  )

  const pendingDataMigrations = dataMigrations
    .filter(({ version }) => {
      return !ranDataMigrationVersions.includes(version)
    })
    .sort(sortDataMigrationsByVersion)

  return pendingDataMigrations
}

/**
 * Sorts migrations by date, oldest first
 */
function sortDataMigrationsByVersion(
  dataMigrationA: { version: string },
  dataMigrationB: { version: string },
) {
  const aVersion = parseInt(dataMigrationA.version)
  const bVersion = parseInt(dataMigrationB.version)

  if (aVersion > bVersion) {
    return 1
  }
  if (aVersion < bVersion) {
    return -1
  }
  return 0
}

async function runDataMigration(db: PrismaClient, dataMigrationPath: string) {
  const { mod } = await bundleRequire({
    filepath: dataMigrationPath,
    // TODO: Add plugins
  })

  const dataMigration = mod.default

  const startedAt = new Date()
  await dataMigration({ db })
  const finishedAt = new Date()

  return { startedAt, finishedAt }
}

export const NO_PENDING_MIGRATIONS_MESSAGE =
  'No pending data migrations run, already up-to-date.'

/**
 * Adds data for completed migrations to the DB
 */
async function recordDataMigration(
  db: PrismaClient,
  { version, name, startedAt, finishedAt }: DataMigration,
) {
  await db.rW_DataMigration.create({
    data: { version, name, startedAt, finishedAt },
  })
}

/**
 * Output run status to the console
 */
function reportDataMigrations(counters: {
  run: number
  skipped: number
  error: number
}) {
  if (counters.run) {
    console.info(
      c.success(`${counters.run} data migration(s) completed successfully.`),
    )
  }
  if (counters.error) {
    console.error(
      c.error(`${counters.error} data migration(s) exited with errors.`),
    )
  }
  if (counters.skipped) {
    console.warn(
      c.warning(
        `${counters.skipped} data migration(s) skipped due to previous error.`,
      ),
    )
  }
}
