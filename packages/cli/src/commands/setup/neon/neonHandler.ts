import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'

import { colors, getPaths, installPackages } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  checkProjectShape,
  getSqliteToPostgresTasks,
} from '../database/postgresHandler.js'

import type { Args } from './neon.js'

interface NeonCtx {
  databaseUrl?: string
  databaseUrlDirect?: string
  neonClaimUrl?: string
  neonClaimExpiry?: string
}

export async function handler({ force }: Args) {
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

  // `.env` is the only reliable signal here, deliberately not
  // `process.env.DATABASE_URL` — every project ships a `.env.defaults` with
  // a SQLite placeholder DATABASE_URL, which `loadEnvFiles()` merges into
  // `process.env` on every CLI invocation regardless of whether Postgres
  // has been configured. Checking `process.env` would make this guard
  // permanently true and skip provisioning on every fresh project.
  let hasExistingDatabaseUrl = false
  if (fs.existsSync(envPath)) {
    hasExistingDatabaseUrl = /^DATABASE_URL=/m.test(
      fs.readFileSync(envPath, 'utf-8'),
    )
  }

  // Provisioning a new database when one is already configured would orphan
  // the existing one, so this only proceeds past the schema/adapter switch
  // (which is safely idempotent on its own) when there's nothing to
  // conflict with yet, or the user explicitly asked to overwrite it.
  const skipProvisioning = hasExistingDatabaseUrl && !force

  const notes: string[] = []

  if (skipProvisioning) {
    notes.push(
      colors.note(
        'DATABASE_URL is already set in .env. Use --force to overwrite.',
      ),
    )
  }

  const tasks = new Listr<NeonCtx>(
    [
      ...getSqliteToPostgresTasks({ dbPath: shape.dbPath }),
      {
        title: 'Setting DIRECT_DATABASE_URL in Prisma config',
        skip: () => skipProvisioning,
        task: (_ctx, task) => {
          const prismaConfigPathCjs = path.join(
            cedarPaths.api.base,
            'prisma.config.cjs',
          )
          const prismaConfigPathMts = path.join(
            cedarPaths.api.base,
            'prisma.config.mts',
          )
          const configPath = fs.existsSync(prismaConfigPathCjs)
            ? prismaConfigPathCjs
            : prismaConfigPathMts

          const configContent = fs.readFileSync(configPath, 'utf-8')

          const datasourceUrlRegex = /(\burl\s*:\s*)env\(["'][^"']*?["']\)/
          if (!datasourceUrlRegex.test(configContent)) {
            task.skip(
              'Could not set DIRECT_DATABASE_URL. Please manually set datasource.url in ' +
                configPath,
            )
            return
          }

          // Neon needs the direct (non-pooler) connection for migrations
          fs.writeFileSync(
            configPath,
            configContent.replace(
              datasourceUrlRegex,
              "$1env('DIRECT_DATABASE_URL')",
            ),
          )
        },
      },
      {
        title: 'Provisioning Neon database',
        skip: () => skipProvisioning,
        task: async (ctx) => {
          const res = await fetch('https://neon.new/api/v1/database', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: 'cedarjs' }),
          })

          if (!res.ok) {
            throw new Error(`Neon API returned ${res.status} ${res.statusText}`)
          }

          const data = await res.json()

          if (!data.connection_string || !data.expires_at || !data.claim_url) {
            throw new Error(
              'Neon API returned an invalid response\n\n' +
                JSON.stringify(data, null, 2),
            )
          }

          ctx.databaseUrl = data.connection_string
          ctx.databaseUrlDirect = data.connection_string.replace(
            '-pooler.',
            '.',
          )

          if (ctx.databaseUrlDirect === ctx.databaseUrl) {
            throw new Error(
              'Could not derive a direct (non-pooler) connection string from the Neon response. ' +
                'Expected the connection string to contain "-pooler." in the hostname.',
            )
          }

          ctx.neonClaimUrl = data.claim_url
          ctx.neonClaimExpiry = new Date(data.expires_at).toUTCString()
        },
      },
      {
        title: 'Writing database connection to .env',
        skip: (ctx) => {
          if (skipProvisioning) {
            return true
          }

          if (!ctx.databaseUrl) {
            return 'No database URL to write (Neon provisioning skipped)'
          }

          return false
        },
        task: (ctx) => {
          let envContent = ''
          if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8')

            if (force) {
              // Filter out existing DATABASE_URL and DIRECT_DATABASE_URL lines
              const lines = envContent.split('\n')
              const filtered = lines.filter(
                (line) =>
                  !line.startsWith('DATABASE_URL=') &&
                  !line.startsWith('DIRECT_DATABASE_URL='),
              )
              envContent = filtered.join('\n').trimEnd()
            }

            if (envContent && !envContent.endsWith('\n')) {
              envContent += '\n'
            }
          }

          envContent += `DATABASE_URL=${ctx.databaseUrl}\n`
          envContent += `DIRECT_DATABASE_URL=${ctx.databaseUrlDirect}\n`

          fs.writeFileSync(envPath, envContent)
        },
      },
      installPackages,
      {
        title: 'Running Prisma migrations',
        skip: (ctx) => {
          if (skipProvisioning) {
            return true
          }

          if (!ctx.databaseUrl) {
            return 'No database provisioned — skipping migration'
          }

          return false
        },
        task: (ctx) => {
          // The process we spawn here will inherit its parent's process.env.
          // We've added DIRECT_DATABASE_URL to the project's .env file, but we
          // haven't refreshed our environment variables. Explicitly passing it
          // in below ensures the migrate command works correctly.
          const result = execa.commandSync(
            'yarn cedar prisma migrate dev --name init-neon',
            {
              cwd: cedarPaths.base,
              stdio: ['inherit', 'inherit', 'pipe'],
              reject: false,
              env: {
                ...process.env,
                DIRECT_DATABASE_URL: ctx.databaseUrlDirect,
              },
            },
          )

          if (result.exitCode !== 0) {
            throw new Error(
              'Prisma migration failed:\n\n' +
                result.stderr +
                '\n\nYou can try running it manually:\n' +
                '  yarn cedar prisma migrate dev --name init-neon',
            )
          }
        },
      },
      {
        title: 'One more thing...',
        task: (ctx, task) => {
          if (skipProvisioning) {
            task.output = 'Skipped — DATABASE_URL already configured'
            return
          }

          const claimMsg = [
            colors.important(
              'Your Neon database has been created and is ready to use!',
            ),
            '',
            `Claim URL:  ${colors.underline(ctx.neonClaimUrl || 'N/A')}`,
            `Expires:    ${ctx.neonClaimExpiry || 'N/A'}`,
            '',
            'Claim your database to keep it beyond the expiration date.',
          ]

          notes.push(...claimMsg)
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
    // false`: unrelated tasks, like "One more thing..." above, still get a
    // chance to run). Silently returning 0 despite a real failure — a
    // provisioning call or migration that never completed — would be worse
    // than what `exitOnError: false` is protecting against.
    if (tasks.errors.length > 0) {
      for (const error of tasks.errors) {
        if (isErrorWithMessage(error)) {
          errorTelemetry(process.argv, error.message)
          console.error(colors.error(error.message))
        }
      }

      process.exit(1)
    }

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
