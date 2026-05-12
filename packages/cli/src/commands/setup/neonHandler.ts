import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { Listr } from 'listr2'

import {
  addApiPackages,
  colors,
  getPaths,
  installPackages,
} from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import type { Args } from './neon.js'

const cedarPaths = getPaths()

export async function handler({ force }: Args) {
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
  const envPath = path.join(cedarPaths.base, '.env')

  let hasDirectDatabaseUrl = false
  if (fs.existsSync(envPath)) {
    hasDirectDatabaseUrl = /^DATABASE_URL=/m.test(
      fs.readFileSync(envPath, 'utf-8'),
    )
  }

  const notes: string[] = []

  const tasks = new Listr(
    [
      {
        title: 'Checking current database configuration',
        task: (ctx) => {
          const schemaContent = fs.readFileSync(schemaPath, 'utf-8')
          ctx.isPostgres = schemaContent.includes('provider = "postgresql"')
          ctx.schemaContent = schemaContent

          if (hasDirectDatabaseUrl && !force) {
            ctx.skipWithNote = true
            notes.push(
              colors.note(
                'DATABASE_URL is already set in .env. Use --force to overwrite.',
              ),
            )
          }
        },
      },
      // --- Project conversion tasks (skip if already postgres) ---
      {
        title: 'Switching Prisma schema to PostgreSQL',
        skip: (ctx) => {
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
          if (ctx.isPostgres) {
            return 'Database adapter is already configured for PostgreSQL'
          }
          return false
        },
        task: () => {
          const neonDbTs = `import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set')
}

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
`
          fs.writeFileSync(dbTsPath, neonDbTs)
        },
      },
      {
        title: 'Updating Prisma config',
        skip: (ctx) => {
          if (ctx.isPostgres) {
            return 'Prisma config is already configured for Neon'
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
      // --- Always-run tasks ---
      addApiPackages(['@prisma/adapter-pg@7.8.0', 'pg@^8.13.0']),
      {
        title: 'Provisioning Neon database',
        skip: () => {
          if (hasDirectDatabaseUrl && !force) {
            return true
          }
          return false
        },
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
          ctx.neonClaimUrl = data.claim_url
          ctx.neonClaimExpiry = new Date(data.expires_at).toUTCString()
        },
      },
      {
        title: 'Writing database connection to .env',
        skip: (ctx) => {
          if (hasDirectDatabaseUrl && !force) {
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
          if (ctx.skipWithNote) {
            return 'DATABASE_URL already configured — skipping migration'
          }
          if (!ctx.databaseUrl) {
            return 'No database provisioned — skipping migration'
          }
          return false
        },
        task: () => {
          execa.commandSync('yarn cedar prisma migrate dev --name init-neon', {
            cwd: cedarPaths.base,
            stdio: 'inherit',
          })
        },
      },
      {
        title: 'One more thing...',
        task: (ctx, task) => {
          if (ctx.skipWithNote) {
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
