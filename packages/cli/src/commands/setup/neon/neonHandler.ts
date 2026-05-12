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
  const rootPkgPath = path.join(cedarPaths.base, 'package.json')
  const apiPkgPath = path.join(cedarPaths.api.base, 'package.json')
  const dbTsTemplatePath = path.join(
    import.meta.dirname,
    'templates',
    'db.ts.template',
  )

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
          ctx.schemaContent = schemaContent

          ctx.isSqlite = schemaContent.includes('provider = "sqlite"')
          ctx.isPostgres = schemaContent.includes('provider = "postgresql"')

          if (fs.existsSync(dbTsPath)) {
            ctx.dbTsContent = fs.readFileSync(dbTsPath, 'utf-8')
            ctx.isNeon = ctx.dbTsContent.includes('PrismaPg')
          } else {
            ctx.isNeon = false
          }

          if (!ctx.isSqlite && !ctx.isPostgres) {
            ctx.unsupportedProvider = true
            notes.push(
              colors.note(
                'setup neon only supports migrating from SQLite to PostgreSQL.' +
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

          if (ctx.isNeon) {
            return 'Database adapter is already configured for Neon (PrismaPg)'
          }

          return false
        },
        task: () => {
          const neonDbTs = fs.readFileSync(dbTsTemplatePath, 'utf-8')
          fs.writeFileSync(dbTsPath, neonDbTs)
        },
      },
      {
        title: 'Updating Prisma config',
        skip: (ctx) => {
          if (ctx.unsupportedProvider) {
            return 'Unsupported database provider'
          }

          if (ctx.isNeon) {
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
      addApiPackages(['@prisma/adapter-pg@7.8.0']),
      {
        title: 'Provisioning Neon database',
        skip: (ctx) => {
          if (ctx.unsupportedProvider) {
            return true
          }
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
          if (ctx.unsupportedProvider) {
            return true
          }

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
          if (ctx.unsupportedProvider) {
            return true
          }
          if (ctx.skipWithNote) {
            return 'DATABASE_URL already configured — skipping migration'
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
          if (ctx.unsupportedProvider) {
            task.output = 'Skipped — unsupported database provider'
            return
          }

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
