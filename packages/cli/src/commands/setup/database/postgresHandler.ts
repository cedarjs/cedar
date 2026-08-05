import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'

import { colors, getPaths, installPackages } from '@cedarjs/cli-helpers'
import { addWorkspacePackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { errorTelemetry } from '@cedarjs/telemetry'

export interface SqliteToPostgresCtx {
  schemaContent?: string
  isSqlite?: boolean
  isPostgres?: boolean
  hasPgAdapter?: boolean
  hasDirectDatabaseUrlConfig?: boolean
  hasPgAdapterPackage?: boolean
  unsupportedProvider?: boolean
  hasSqliteUsageOutsideDb?: boolean
}

/**
 * The provider-agnostic half of the SQLite → PostgreSQL switch: schema,
 * dependencies, and the database adapter. Shared by `setup database
 * postgres` and `setup neon`, which adds provisioning and `.env` handling on
 * top of this.
 *
 * Mutates `notes` in place — same convention as the rest of this file's Listr
 * tasks — so the caller can print them after the task list finishes.
 */
export function getSqliteToPostgresTasks({
  notes,
}: {
  notes: string[]
}): ListrTask<SqliteToPostgresCtx>[] {
  const cedarPaths = getPaths()
  const schemaPath = path.join(cedarPaths.api.base, 'db', 'schema.prisma')
  const dbTsPath = path.join(cedarPaths.api.src, 'lib', 'db.ts')
  const prismaConfigPathCjs = path.join(
    cedarPaths.api.base,
    'prisma.config.cjs',
  )
  const prismaConfigPathMts = path.join(
    cedarPaths.api.base,
    'prisma.config.mts',
  )
  const rootPkgPath = path.join(cedarPaths.base, 'package.json')
  const apiPkgPath = path.join(cedarPaths.api.base, 'package.json')
  const dbTsTemplatePath = path.join(
    import.meta.dirname,
    'templates',
    'db.ts.template',
  )

  return [
    {
      title: 'Checking current database configuration',
      task: (ctx) => {
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8')
        ctx.schemaContent = schemaContent

        ctx.isSqlite = schemaContent.includes('provider = "sqlite"')
        ctx.isPostgres = schemaContent.includes('provider = "postgresql"')

        if (fs.existsSync(dbTsPath)) {
          ctx.hasPgAdapter = fs
            .readFileSync(dbTsPath, 'utf-8')
            .includes('PrismaPg')
        } else {
          ctx.hasPgAdapter = false
        }

        // Independent of `hasPgAdapter` — a project can have db.ts already
        // switched over while prisma.config or api/package.json are still
        // pending, e.g. someone edited db.ts by hand. Each of these three
        // has to be checked (and, below, skipped) on its own, or a partial
        // conversion looks "already configured" and never gets finished.
        const prismaConfigPath = fs.existsSync(prismaConfigPathCjs)
          ? prismaConfigPathCjs
          : fs.existsSync(prismaConfigPathMts)
            ? prismaConfigPathMts
            : undefined

        ctx.hasDirectDatabaseUrlConfig = prismaConfigPath
          ? /env\(["']DIRECT_DATABASE_URL["']\)/.test(
              fs.readFileSync(prismaConfigPath, 'utf-8'),
            )
          : false

        const apiPkg = JSON.parse(fs.readFileSync(apiPkgPath, 'utf-8'))
        ctx.hasPgAdapterPackage = Boolean(
          apiPkg.dependencies?.['@prisma/adapter-pg'],
        )

        if (!ctx.isSqlite && !ctx.isPostgres) {
          ctx.unsupportedProvider = true
          notes.push(
            colors.note(
              'This command only supports migrating from SQLite to PostgreSQL.' +
                ' Your project uses a different database provider.',
            ),
          )

          return
        }

        if (!ctx.isPostgres) {
          ctx.hasSqliteUsageOutsideDb = hasSqliteUsageOutsideDb(
            cedarPaths.api.src,
            dbTsPath,
          )
        }
      },
    },
    {
      title: 'Removing SQLite dependencies from api/package.json',
      skip: (ctx) => {
        if (ctx.unsupportedProvider) {
          return 'Unsupported database provider'
        }

        if (ctx.isPostgres) {
          return 'Already configured for PostgreSQL'
        }

        if (ctx.hasSqliteUsageOutsideDb) {
          return 'SQLite is in use outside db.ts — keeping packages'
        }

        return false
      },
      task: () => {
        const pkg = JSON.parse(fs.readFileSync(apiPkgPath, 'utf-8'))

        if (pkg.dependencies) {
          delete pkg.dependencies['better-sqlite3']
          delete pkg.dependencies['@prisma/adapter-better-sqlite3']
        }

        fs.writeFileSync(apiPkgPath, JSON.stringify(pkg, null, 2) + '\n')
      },
    },
    {
      title: 'Removing better-sqlite3 dependenciesMeta',
      skip: (ctx) => {
        if (ctx.unsupportedProvider) {
          return 'Unsupported database provider'
        }

        if (ctx.isPostgres) {
          return 'Already configured for PostgreSQL'
        }

        if (ctx.hasSqliteUsageOutsideDb) {
          return "SQLite is in use outside db.ts so we're keeping it installed"
        }

        return false
      },
      task: () => {
        if (!fs.existsSync(rootPkgPath)) {
          return
        }

        const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'))

        if (pkg.dependenciesMeta?.['better-sqlite3']) {
          delete pkg.dependenciesMeta['better-sqlite3']

          if (Object.keys(pkg.dependenciesMeta).length === 0) {
            delete pkg.dependenciesMeta
          }

          fs.writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + '\n')
        }
      },
    },
    {
      title: 'Switching Prisma schema to PostgreSQL',
      skip: (ctx) => {
        if (ctx.unsupportedProvider) {
          return 'Unsupported database provider'
        }

        if (ctx.isPostgres) {
          return 'Schema is already configured for PostgreSQL'
        }

        return false
      },
      task: (ctx) => {
        const updated = (ctx.schemaContent as string).replace(
          'provider = "sqlite"',
          'provider = "postgresql"',
        )
        fs.writeFileSync(schemaPath, updated)
      },
    },
    {
      title: 'Updating database adapter',
      skip: (ctx) => {
        if (ctx.unsupportedProvider) {
          return 'Unsupported database provider'
        }

        if (ctx.hasPgAdapter) {
          return 'Database adapter is already configured for PostgreSQL (PrismaPg)'
        }

        return false
      },
      task: () => {
        const pgDbTs = fs.readFileSync(dbTsTemplatePath, 'utf-8')
        fs.writeFileSync(dbTsPath, pgDbTs)
      },
    },
    {
      title: 'Updating Prisma config',
      skip: (ctx) => {
        if (ctx.unsupportedProvider) {
          return 'Unsupported database provider'
        }

        if (ctx.hasDirectDatabaseUrlConfig) {
          return 'Prisma config is already configured for PostgreSQL'
        }

        return false
      },
      task: () => {
        if (
          !fs.existsSync(prismaConfigPathCjs) &&
          !fs.existsSync(prismaConfigPathMts)
        ) {
          throw new Error(
            'No Prisma config file found. Expected prisma.config.cjs or prisma.config.mts in the api directory.',
          )
        }

        const configPath = fs.existsSync(prismaConfigPathCjs)
          ? prismaConfigPathCjs
          : prismaConfigPathMts

        const configContent = fs.readFileSync(configPath, 'utf-8')
        const updated = configContent.replace(
          /env\(["']DATABASE_URL["']\)/,
          "env('DIRECT_DATABASE_URL')",
        )
        fs.writeFileSync(configPath, updated)
      },
    },
    {
      title: 'Adding required api packages...',
      skip: (ctx) => {
        if (ctx.unsupportedProvider) {
          return 'Unsupported database provider'
        }

        if (ctx.hasPgAdapterPackage) {
          return 'PostgreSQL packages are already installed'
        }

        return false
      },
      task: async () => {
        await addWorkspacePackages('api', ['@prisma/adapter-pg@7.8.0'], {
          cwd: cedarPaths.api.base,
        })
      },
    },
  ]
}

function readEnvVar(envContent: string, name: string): string | undefined {
  // An empty value (`NAME=`) is treated the same as the variable being
  // absent entirely — `??` alone would treat `''` as "set" and stop there,
  // short-circuiting the DIRECT_DATABASE_URL fallback below before it ever
  // reaches DATABASE_URL.
  return envContent.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] || undefined
}

export async function handler() {
  const cedarPaths = getPaths()
  const envPath = path.join(cedarPaths.base, '.env')
  const envContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8')
    : ''

  const databaseUrl =
    process.env.DATABASE_URL || readEnvVar(envContent, 'DATABASE_URL')

  // The "Updating Prisma config" task above rewrites prisma.config to read
  // migrations from DIRECT_DATABASE_URL, not DATABASE_URL — Neon-style
  // pooled/direct splits aside, most providers only hand out one connection
  // string, so default to that rather than leaving migrations with nothing
  // to connect with.
  const directDatabaseUrl =
    process.env.DIRECT_DATABASE_URL ||
    readEnvVar(envContent, 'DIRECT_DATABASE_URL') ||
    databaseUrl

  const notes: string[] = []

  const tasks = new Listr(
    [
      ...getSqliteToPostgresTasks({ notes }),
      installPackages,
      {
        title: 'Running Prisma migrations',
        skip: (ctx: SqliteToPostgresCtx) => {
          if (ctx.unsupportedProvider) {
            return true
          }

          if (!databaseUrl) {
            return (
              'No DATABASE_URL found in .env — set it to your PostgreSQL ' +
              'connection string, then run `yarn cedar prisma migrate dev`'
            )
          }

          return false
        },
        task: () => {
          const result = execa.commandSync(
            'yarn cedar prisma migrate dev --name init-postgres',
            {
              cwd: cedarPaths.base,
              stdio: ['inherit', 'inherit', 'pipe'],
              reject: false,
              env: {
                ...process.env,
                DIRECT_DATABASE_URL: directDatabaseUrl,
              },
            },
          )

          if (result.exitCode !== 0) {
            throw new Error(
              'Prisma migration failed:\n\n' +
                result.stderr +
                '\n\nYou can try running it manually:\n' +
                '  yarn cedar prisma migrate dev --name init-postgres',
            )
          }
        },
      },
    ],
    {
      exitOnError: false,
    },
  )

  try {
    await tasks.run()

    if (notes.length > 0) {
      console.log()
      console.log(notes.join('\n'))
    }
  } catch (e) {
    if (isErrorWithMessage(e)) {
      errorTelemetry(process.argv, e.message)
      console.error(colors.error(e.message))
    }

    if (isErrorWithExitCode(e)) {
      process.exit(e.exitCode)
    }

    process.exit(1)
  }
}

function isErrorWithMessage(e: unknown): e is { message: string } {
  return !!e && typeof e === 'object' && 'message' in e
}

function isErrorWithExitCode(e: unknown): e is { exitCode: number } {
  return (
    !!e &&
    typeof e === 'object' &&
    'exitCode' in e &&
    typeof e.exitCode === 'number'
  )
}

function hasSqliteUsageOutsideDb(srcPath: string, dbTsPath: string): boolean {
  const sqlitePattern = /better-sqlite3|@prisma\/adapter-better-sqlite3/

  const files = fs.globSync('**/*.{ts,tsx,js,jsx}', { cwd: srcPath })

  for (const file of files) {
    const fullPath = path.join(srcPath, file)

    if (fullPath === dbTsPath) {
      continue
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8')

      if (sqlitePattern.test(content)) {
        return true
      }
    } catch {
      // Skip unreadable files
    }
  }

  return false
}
