import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'

import { colors, getPaths, installPackages } from '@cedarjs/cli-helpers'
import { prettyPrintCedarCommand } from '@cedarjs/cli-helpers/packageManager'
import { addWorkspacePackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { resolveFile } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

interface ShapeOk {
  ok: true
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
 * conversion) doesn't get guessed at: it's reported back so the caller can
 * bail with a clear message instead.
 */
export function checkProjectShape(
  cedarPaths: ReturnType<typeof getPaths>,
): ProjectShape {
  const schemaPath = path.join(cedarPaths.api.base, 'db', 'schema.prisma')
  const dbPath = resolveFile(path.join(cedarPaths.api.lib, 'db'))

  if (!fs.existsSync(schemaPath)) {
    return blocked(`Could not find ${schemaPath}.`)
  }

  if (!dbPath) {
    return blocked(`No ${path.join(cedarPaths.api.lib, 'db')} file found`)
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8')
  const hasPgAdapter = fs.readFileSync(dbPath, 'utf-8').includes('PrismaPg')

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
        'partial previous conversion). Please switch it over to PostgreSQL ' +
        'manually.',
    )
  }

  return { ok: true, dbPath }
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
  dbPath,
}: {
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
  // absent entirely.
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

  // Setup commands are run locally, with all connection info expected in
  // .env. A generic Postgres provider only hands out one connection string, so
  // prisma.config keeps reading DATABASE_URL as-is and no DIRECT_DATABASE_URL
  // split is needed here.
  const databaseUrl = readEnvVar(envContent, 'DATABASE_URL')

  const tasks = new Listr(
    [
      ...getSqliteToPostgresTasks({ dbPath: shape.dbPath }),
      installPackages,
      {
        title: 'Running Prisma migrations',
        skip: () => {
          if (!databaseUrl) {
            return (
              'No DATABASE_URL found in `.env`. Set it to your PostgreSQL ' +
              'connection string, then run ' +
              `\`${prettyPrintCedarCommand(['prisma', 'migrate', 'dev'])}\``
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
            },
          )

          if (result.exitCode !== 0) {
            throw new Error(
              'Prisma migration failed:\n\n' +
                result.stderr +
                '\n\nYou can try running it manually:\n' +
                `  ${prettyPrintCedarCommand(['prisma', 'migrate', 'dev', '--name', 'init-postgres'])}`,
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
