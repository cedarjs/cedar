import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'
import { createServer, isRunnableDevEnvironment } from 'vite'

import { colors as c } from '@cedarjs/cli-helpers'
import {
  getPaths,
  getDataMigrationsPath,
  resolveFile,
  importStatementPath,
} from '@cedarjs/project-config'

import type { DataMigrateUpOptions, DataMigration } from '../types'

interface DataMigrateDb {
  rW_DataMigration: {
    findMany(args?: {
      orderBy?: Record<string, 'asc' | 'desc'>
    }): Promise<DataMigration[]>
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
  $disconnect(): Promise<void>
}

function resolveId(id: string): string {
  if (fs.existsSync(id) && fs.statSync(id).isFile()) {
    return id
  }

  const withoutExt = /\.jsx?$/.test(id) ? id.replace(/\.jsx?$/, '') : id
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    if (fs.existsSync(withoutExt + ext)) {
      return withoutExt + ext
    }
  }

  if (fs.existsSync(id) && fs.statSync(id).isDirectory()) {
    for (const base of ['index', path.basename(id)]) {
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = path.join(id, base + ext)
        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
    }
  }

  return id
}

export async function handler({
  importDbClientFromDist,
  distPath,
}: DataMigrateUpOptions) {
  let db: any
  let server: any = null
  let cedarPlugins: Record<string, (...args: any[]) => any>

  async function getRunner() {
    if (!server) {
      if (!cedarPlugins) {
        // Dynamic import works in both CJS and ESM contexts. The CJS barrel
        // uses `export type *` which makes TypeScript see only types, but the
        // real CJS module has values at runtime.
        const mod = await import('@cedarjs/vite')
        cedarPlugins = mod as Record<string, (...args: any[]) => any>
      }

      server = await createServer({
        mode: 'production',
        optimizeDeps: {
          noDiscovery: true,
          include: undefined,
        },
        server: {
          hmr: false,
          watch: null,
        },
        environments: {
          nodeRunnerEnv: {},
        },
        resolve: {
          alias: [
            {
              find: /^api\//,
              replacement: getPaths().api.base + '/',
            },
            {
              find: /^src\//,
              replacement: 'src/',
              customResolver: (id, importer, _options) => {
                const apiImportBase = importStatementPath(getPaths().api.base)
                if (importer?.startsWith(apiImportBase)) {
                  const apiImportSrc = importStatementPath(getPaths().api.src)
                  const apiId = id.replace('src', apiImportSrc)
                  return { id: resolveId(apiId) }
                }
                return null
              },
            },
          ],
        },
        plugins: [
          cedarPlugins.cedarCjsCompatPlugin(),
          cedarPlugins.cedarjsResolveCedarStyleImportsPlugin(),
          cedarPlugins.cedarImportDirPlugin(),
          cedarPlugins.cedarAutoImportsPlugin(),
        ],
      })
    }

    const env = server.environments.nodeRunnerEnv
    if (!env || !isRunnableDevEnvironment(env)) {
      throw new Error('Vite environment is not runnable.')
    }

    return env.runner
  }

  if (importDbClientFromDist) {
    if (!fs.existsSync(distPath)) {
      console.warn(
        `Can't find api dist at ${distPath}. You may need to build first: ` +
          'yarn cedar build api',
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

    const runner = await getRunner()
    const dbModule = await runner.import(dbPath)
    db = dbModule.db
  }

  const pendingDataMigrations = await getPendingDataMigrations(db)

  if (!pendingDataMigrations.length) {
    console.info(c.success(`\n${NO_PENDING_MIGRATIONS_MESSAGE}\n`))
    process.exitCode = 0
    await server?.close()
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
          const message = e instanceof Error ? e.message : String(e)
          console.error(c.error(`Error in data migration: ${message}`))
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
  } finally {
    if (server) {
      await server.close()
    }
  }

  async function runDataMigration(
    db: DataMigrateDb,
    dataMigrationPath: string,
  ) {
    const runner = await getRunner()
    const dataMigrationModule = await runner.import(dataMigrationPath)
    const dataMigration = dataMigrationModule.default

    const startedAt = new Date()
    await dataMigration({ db })
    const finishedAt = new Date()

    return { startedAt, finishedAt }
  }
}

async function getPendingDataMigrations(db: DataMigrateDb) {
  const dataMigrationsPath = await getDataMigrationsPath(
    getPaths().api.prismaConfig,
  )

  if (!fs.existsSync(dataMigrationsPath)) {
    return []
  }

  const dataMigrations = fs
    .readdirSync(dataMigrationsPath)
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

export const NO_PENDING_MIGRATIONS_MESSAGE =
  'No pending data migrations run, already up-to-date.'

async function recordDataMigration(
  db: DataMigrateDb,
  { version, name, startedAt, finishedAt }: DataMigration,
) {
  await db.rW_DataMigration.create({
    data: { version, name, startedAt, finishedAt },
  })
}

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
