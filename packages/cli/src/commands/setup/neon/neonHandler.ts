import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'
import prompts from 'prompts'

import {
  colors,
  getPaths,
  installPackages,
  requireTTYOrExit,
} from '@cedarjs/cli-helpers'
import { prettyPrintCedarCommand } from '@cedarjs/cli-helpers/packageManager'
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
  directDatabaseUrlNotSet?: boolean
}

// Mirrors how dotenv-style tooling (and `readEnvVar` in postgresHandler.ts)
// treats a single layer of matching quotes around a value, then requires
// what's left to actually parse as a Postgres URL with a host — rejecting
// protocol-only values like `postgres://` that `new URL()` accepts but
// Neon/Prisma can't connect with.
function isPostgresConnectionString(rawValue: string): boolean {
  let value = rawValue.trim()
  const quoted = value.match(/^(['"])(.*)\1$/)
  if (quoted) {
    value = quoted[2]
  }

  if (!value) {
    return false
  }

  try {
    const url = new URL(value)
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      !!url.hostname
    )
  } catch {
    return false
  }
}

export async function handler({ force, migrations, verbose }: Args) {
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
  //
  // The value is inspected too, not just the key's presence — a `file:`
  // SQLite path (e.g. from `.env.defaults`), a blank value, or a malformed
  // one (e.g. `postgres://` with no host) must not be mistaken for an
  // already-configured Postgres connection string.
  let hasExistingDatabaseUrl = false
  if (fs.existsSync(envPath)) {
    const match = fs
      .readFileSync(envPath, 'utf-8')
      .match(/^DATABASE_URL=(.*)$/m)
    hasExistingDatabaseUrl =
      !!match?.[1] && isPostgresConnectionString(match[1])
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

  // Resolve whether to run migrations: flag > prompt. Only relevant when
  // provisioning is actually going to happen - the migrations task is
  // unconditionally skipped otherwise, so prompting would be pointless.
  let runMigrations = migrations
  if (!skipProvisioning && runMigrations === undefined) {
    requireTTYOrExit('--migrations or --no-migrations')

    const response = await prompts({
      type: 'toggle',
      name: 'runMigrations',
      message: 'Run Prisma migrations now?',
      initial: true,
      active: 'Yes',
      inactive: 'No',
    })
    // prompts returns undefined for the value if the user ctrl-c's
    if (response.runMigrations === undefined) {
      process.exit(0)
    }
    runMigrations = response.runMigrations
  }

  const tasks = new Listr<NeonCtx>(
    [
      ...getSqliteToPostgresTasks({ dbPath: shape.dbPath }),
      {
        title: 'Setting DIRECT_DATABASE_URL in Prisma config',
        skip: () => skipProvisioning,
        task: (ctx, task) => {
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
            // Whatever prisma.config actually reads for its datasource is
            // now unknown — it might still be pointed at a database from
            // before this conversion. Provisioning and writing the new
            // connection strings to .env below are harmless either way,
            // but running migrations against an unconfirmed datasource
            // could target the wrong database, so that's blocked below.
            ctx.directDatabaseUrlNotSet = true
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
      installPackages,
      {
        title: 'Running Prisma migrations',
        skip: (ctx) => {
          if (skipProvisioning) {
            return true
          }

          if (!runMigrations) {
            return migrations === false
              ? 'Skipped (--no-migrations)'
              : 'Skipped'
          }

          if (ctx.directDatabaseUrlNotSet) {
            return (
              'Skipping migrations — could not confirm prisma.config is ' +
              'reading DIRECT_DATABASE_URL, so migrations could target the ' +
              'wrong database. Fix datasource.url, then run ' +
              `\`${prettyPrintCedarCommand(['prisma', 'migrate', 'dev'])}\` manually.`
            )
          }

          return false
        },
        task: (ctx) => {
          // The process we spawn here will inherit its parent's process.env.
          // DIRECT_DATABASE_URL hasn't been written to .env yet (that
          // happens below, only once migrations have succeeded), so it's
          // passed explicitly here — the migrate command doesn't need the
          // file to be written first.
          const result = execa.commandSync(
            'yarn cedar prisma migrate dev --name init-neon',
            {
              cwd: cedarPaths.base,
              stdio: verbose ? 'inherit' : ['inherit', 'inherit', 'pipe'],
              reject: false,
              env: {
                ...process.env,
                DIRECT_DATABASE_URL: ctx.databaseUrlDirect,
              },
            },
          )

          if (result.exitCode !== 0) {
            throw new Error(
              verbose
                ? 'Prisma migration failed. You can try running it manually:\n' +
                    `  ${prettyPrintCedarCommand(['prisma', 'migrate', 'dev', '--name', 'init-neon'])}`
                : 'Prisma migration failed:\n\n' +
                    result.stderr +
                    '\n\nYou can try running it manually:\n' +
                    `  ${prettyPrintCedarCommand(['prisma', 'migrate', 'dev', '--name', 'init-neon'])}`,
            )
          }
        },
      },
      {
        title: 'Writing database connection to .env',
        // Deliberately runs after migrations, not before — with
        // `exitOnError: true`, a migration failure stops the list here and
        // this task never runs. That means a project whose migrations
        // failed never has DATABASE_URL/DIRECT_DATABASE_URL written to
        // .env, so it's never left pointing at a Neon database it doesn't
        // know it needs to claim. Provisioning that database anyway (and
        // letting it expire unclaimed) is fine — it's exactly as if the
        // command were re-run from scratch, which is safe.
        skip: () => skipProvisioning,
        task: (ctx) => {
          let envContent = ''
          if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8')

            // This task only runs when provisioning wasn't skipped — either
            // --force was passed, or there was no usable DATABASE_URL to
            // begin with (absent, blank, SQLite, or malformed). In every
            // case any existing DATABASE_URL/DIRECT_DATABASE_URL lines are
            // stale and must be replaced, not appended alongside.
            const lines = envContent.split('\n')
            const filtered = lines.filter(
              (line) =>
                !line.startsWith('DATABASE_URL=') &&
                !line.startsWith('DIRECT_DATABASE_URL='),
            )
            envContent = filtered.join('\n').trimEnd()

            if (envContent && !envContent.endsWith('\n')) {
              envContent += '\n'
            }
          }

          envContent += `DATABASE_URL=${ctx.databaseUrl}\n`
          envContent += `DIRECT_DATABASE_URL=${ctx.databaseUrlDirect}\n`

          fs.writeFileSync(envPath, envContent)
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
      // Migrations run before .env is written (see above) specifically so
      // that a failure here — the one step that shouldn't be allowed to
      // continue — stops the whole list via the default exitOnError
      // behavior, rather than needing every later task to know to skip.
      exitOnError: true,
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
