import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'

import { colors, getPaths, installPackages } from '@cedarjs/cli-helpers'
import { addWorkspacePackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { errorTelemetry } from '@cedarjs/telemetry'

interface ShapeOk {
  ok: true
  prismaConfigPath: string
  dbPath: string
}

interface ShapeBlocked {
  ok: false
  alreadyConverted: boolean
  message: string
}

export type ProjectShape = ShapeOk | ShapeBlocked

/**
 * Checks whether the project looks like an untouched Cedar SQLite setup —
 * the one shape this command knows how to convert safely — before any file
 * gets mutated. Anything else (a different provider, a partial previous
 * conversion, SQLite used somewhere removing its packages would break)
 * doesn't get guessed at: it's reported back so the caller can bail with a
 * clear message instead.
 */
export function checkProjectShape(
  cedarPaths: ReturnType<typeof getPaths>,
): ProjectShape {
  const schemaPath = path.join(cedarPaths.api.base, 'db', 'schema.prisma')
  const dbTsPath = path.join(cedarPaths.api.src, 'lib', 'db.ts')
  const dbJsPath = path.join(cedarPaths.api.src, 'lib', 'db.js')
  // JavaScript projects use db.js, not db.ts — falls back to the .ts path
  // (matching the template this command writes) when neither exists yet.
  const dbPath = fs.existsSync(dbTsPath)
    ? dbTsPath
    : fs.existsSync(dbJsPath)
      ? dbJsPath
      : dbTsPath

  if (!fs.existsSync(schemaPath)) {
    return blocked(`Could not find ${schemaPath}.`)
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8')
  const hasPgAdapter =
    fs.existsSync(dbPath) &&
    fs.readFileSync(dbPath, 'utf-8').includes('PrismaPg')

  if (schemaContent.includes('provider = "postgresql"') && hasPgAdapter) {
    return {
      ok: false,
      alreadyConverted: true,
      message: 'This project is already configured for PostgreSQL.',
    }
  }

  if (!schemaContent.includes('provider = "sqlite"') || hasPgAdapter) {
    return blocked(
      'This command only converts a project that is still on SQLite, with ' +
        'the default adapter in api/src/lib/db.ts (or db.js) untouched. ' +
        "This project doesn't match that shape (a different provider, or a " +
        'partial previous conversion) — switch it over to PostgreSQL ' +
        'manually.',
    )
  }

  const prismaConfigPathCjs = path.join(
    cedarPaths.api.base,
    'prisma.config.cjs',
  )
  const prismaConfigPathMts = path.join(
    cedarPaths.api.base,
    'prisma.config.mts',
  )
  const prismaConfigPath = fs.existsSync(prismaConfigPathCjs)
    ? prismaConfigPathCjs
    : fs.existsSync(prismaConfigPathMts)
      ? prismaConfigPathMts
      : undefined

  if (!prismaConfigPath) {
    return blocked(
      'No Prisma config file found. Expected prisma.config.cjs or ' +
        'prisma.config.mts in the api directory.',
    )
  }

  const prismaConfigContent = fs.readFileSync(prismaConfigPath, 'utf-8')
  if (!findDatasourceUrlLine(prismaConfigContent, 'DATABASE_URL')) {
    return blocked(
      `Could not find an active \`url: env('DATABASE_URL')\` line in ` +
        `${prismaConfigPath}. Update it to read DIRECT_DATABASE_URL manually.`,
    )
  }

  if (
    hasSqliteUsageOutsideDb(cedarPaths.api.src, dbPath) ||
    hasSqliteUsageOutsideDb(cedarPaths.scripts, dbPath)
  ) {
    return blocked(
      'Found `better-sqlite3` usage outside api/src/lib/db.ts (or db.js). ' +
        'Removing the SQLite packages could break that code — switch this ' +
        'project over to PostgreSQL manually.',
    )
  }

  return { ok: true, prismaConfigPath, dbPath }
}

function blocked(message: string): ShapeBlocked {
  return { ok: false, alreadyConverted: false, message }
}

/**
 * The provider-agnostic half of the SQLite → PostgreSQL switch: schema,
 * dependencies, and the database adapter. Shared by `setup database
 * postgres` and `setup neon`, which adds provisioning and `.env` handling on
 * top of this.
 *
 * Only called once `checkProjectShape()` has confirmed the project matches
 * the one shape this knows how to convert, so every task here can just do
 * its job unconditionally instead of re-checking its own preconditions.
 */
export function getSqliteToPostgresTasks({
  prismaConfigPath,
  dbPath,
}: {
  prismaConfigPath: string
  dbPath: string
}): ListrTask[] {
  const cedarPaths = getPaths()
  const schemaPath = path.join(cedarPaths.api.base, 'db', 'schema.prisma')
  const rootPkgPath = path.join(cedarPaths.base, 'package.json')
  const apiPkgPath = path.join(cedarPaths.api.base, 'package.json')
  const dbTsTemplatePath = path.join(
    import.meta.dirname,
    'templates',
    'db.ts.template',
  )

  return [
    {
      title: 'Removing SQLite dependencies from api/package.json',
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
      task: () => {
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8')
        fs.writeFileSync(
          schemaPath,
          schemaContent.replace(
            'provider = "sqlite"',
            'provider = "postgresql"',
          ),
        )
      },
    },
    {
      title: 'Updating database adapter',
      task: () => {
        const pgDbTs = fs.readFileSync(dbTsTemplatePath, 'utf-8')
        fs.writeFileSync(dbPath, pgDbTs)
      },
    },
    {
      title: 'Updating Prisma config',
      task: () => {
        const configContent = fs.readFileSync(prismaConfigPath, 'utf-8')
        const active = findDatasourceUrlLine(configContent, 'DATABASE_URL')

        if (!active) {
          // `checkProjectShape()` already confirmed this line exists — this
          // is just a defensive backstop against the file changing between
          // that check and this task running, not an expected path.
          throw new Error(
            `Could not find an active \`url: env('DATABASE_URL')\` line in ` +
              `${prismaConfigPath} anymore.`,
          )
        }

        const lines = configContent.split('\n')
        lines[active.lineIndex] = active.line.replace(
          /(\burl\s*:\s*)env\(["']DATABASE_URL["']\)/,
          "$1env('DIRECT_DATABASE_URL')",
        )
        fs.writeFileSync(prismaConfigPath, lines.join('\n'))
      },
    },
    {
      title: 'Adding required api packages...',
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

  const shape = checkProjectShape(cedarPaths)
  if (!shape.ok) {
    if (shape.alreadyConverted) {
      console.log(colors.note(shape.message))
      return
    }

    console.error(colors.error(shape.message))
    process.exit(1)
  }

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

  // The fallback above only lives in this process — passed to the migration
  // subprocess's env below, but never persisted. Without writing it to
  // .env too, this run's migration succeeds, but any Prisma command run
  // manually afterwards has nothing to resolve DIRECT_DATABASE_URL from.
  if (!readEnvVar(envContent, 'DIRECT_DATABASE_URL') && directDatabaseUrl) {
    const updatedEnvContent =
      envContent && !envContent.endsWith('\n') ? envContent + '\n' : envContent
    fs.writeFileSync(
      envPath,
      updatedEnvContent + `DIRECT_DATABASE_URL=${directDatabaseUrl}\n`,
    )
  }

  const tasks = new Listr(
    [
      ...getSqliteToPostgresTasks({
        prismaConfigPath: shape.prismaConfigPath,
        dbPath: shape.dbPath,
      }),
      installPackages,
      {
        title: 'Running Prisma migrations',
        skip: () => {
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
      collectErrors: 'minimal',
    },
  )

  try {
    await tasks.run()

    // With `exitOnError: false`, a failed task doesn't reject `run()` — it's
    // collected here instead (that's the whole point of `exitOnError:
    // false`: unrelated tasks still get a chance to run). Silently
    // returning 0 despite a real failure — a broken conversion, or a
    // migration that never ran — would be worse than what `exitOnError:
    // false` is protecting against.
    if (tasks.errors.length > 0) {
      for (const error of tasks.errors) {
        if (isErrorWithMessage(error)) {
          errorTelemetry(process.argv, error.message)
          console.error(colors.error(error.message))
        }
      }

      process.exit(1)
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

/**
 * Finds the line in a prisma.config file that actually sets
 * `url: env('<envVarName>')`, ignoring `//` comments — so a comment
 * mentioning or demonstrating that same text doesn't get mistaken for the
 * real, active datasource setting, whether that's for detecting it or for
 * rewriting it.
 *
 * Doesn't handle block comments — prisma.config is a small, generated
 * object where that isn't a realistic shape to guard against, so this only
 * strips what's actually been seen to cause a false match.
 */
function findDatasourceUrlLine(
  content: string,
  envVarName: string,
): { line: string; lineIndex: number } | undefined {
  const pattern = new RegExp(`\\burl\\s*:\\s*env\\(["']${envVarName}["']\\)`)
  const lines = content.split('\n')

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const codePart = line.split('//')[0]

    if (pattern.test(codePart)) {
      return { line, lineIndex }
    }
  }

  return undefined
}

function hasSqliteUsageOutsideDb(srcPath: string, dbPath: string): boolean {
  const sqlitePattern = /better-sqlite3|@prisma\/adapter-better-sqlite3/

  const files = fs.globSync('**/*.{ts,tsx,js,jsx}', { cwd: srcPath })

  for (const file of files) {
    const fullPath = path.join(srcPath, file)

    if (fullPath === dbPath) {
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
