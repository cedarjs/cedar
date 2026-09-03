vi.mock('node:fs')

import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import type * as CliHelpersColors from '@cedarjs/cli-helpers/colors'
import type * as CliHelpersInstallHelpers from '@cedarjs/cli-helpers/installHelpers'
import type * as CliHelpersPaths from '@cedarjs/cli-helpers/paths'

import '../../../../lib/mockTelemetry.js'

import { globSyncByExtension } from '../../../../__tests__/globSyncStub.js'
import { Listr2Mock } from '../../../../__tests__/Listr2Mock.js'

vi.mock('node:fs', async () => {
  const globSync = (_pattern: string, opts: { cwd: string }) =>
    globSyncByExtension(opts.cwd, ['ts', 'tsx', 'js', 'jsx'])

  return {
    ...memfsFs,
    globSync,
    default: { ...memfsFs, globSync },
  }
})

vi.mock('listr2', () => ({ Listr: Listr2Mock }))

const commandSync = vi.fn(() => ({ exitCode: 0, stderr: '' }))
vi.mock('execa', () => ({ default: { commandSync: () => commandSync() } }))

vi.mock('@cedarjs/cli-helpers/packageManager/packages', () => ({
  addWorkspacePackages: vi.fn(async () => {}),
}))

vi.mock('@cedarjs/cli-helpers/packageManager', () => ({
  prettyPrintCedarCommand: (args: string[] = []) =>
    `yarn cedar ${args.join(' ')}`,
}))

const BASE_PATH = '/path/to/project'

vi.mock('@cedarjs/cli-helpers/colors', async (importOriginal) => {
  const original = await importOriginal<typeof CliHelpersColors>()

  return {
    ...original,
    colors: Object.fromEntries(
      [
        'error',
        'warning',
        'highlight',
        'success',
        'info',
        'bold',
        'underline',
        'note',
        'tip',
        'important',
        'caution',
        'link',
      ].map((k) => [k, (s: string) => s]),
    ),
  }
})

vi.mock('@cedarjs/cli-helpers/paths', async (importOriginal) => {
  const original = await importOriginal<typeof CliHelpersPaths>()

  return {
    ...original,
    getPaths: () => ({
      base: BASE_PATH,
      api: {
        base: path.join(BASE_PATH, 'api'),
        src: path.join(BASE_PATH, 'api', 'src'),
        lib: path.join(BASE_PATH, 'api', 'src', 'lib'),
      },
      scripts: path.join(BASE_PATH, 'scripts'),
    }),
  }
})

vi.mock('@cedarjs/cli-helpers/installHelpers', async (importOriginal) => {
  const original = await importOriginal<typeof CliHelpersInstallHelpers>()

  return {
    ...original,
    installPackages: { title: 'Installing packages...', task: async () => {} },
  }
})

const { handler } = await import('../neonHandler.js')

const SQLITE_SCHEMA = 'datasource db {\n  provider = "sqlite"\n}\n'
const POSTGRES_SCHEMA = 'datasource db {\n  provider = "postgresql"\n}\n'

function seedSqliteProject() {
  vol.fromJSON(
    {
      'package.json': JSON.stringify({
        dependenciesMeta: { 'better-sqlite3': { built: true } },
      }),
      'api/package.json': JSON.stringify({
        dependencies: {
          'better-sqlite3': '1.0.0',
          '@prisma/adapter-better-sqlite3': '1.0.0',
        },
      }),
      'api/db/schema.prisma': SQLITE_SCHEMA,
      'api/prisma.config.cjs':
        "module.exports = defineConfig({ datasource: { url: env('DATABASE_URL') } })",
      'api/src/lib/db.ts': '// sqlite adapter',
      [path.join(__dirname, '../../database/templates/db.ts.template')]:
        '// pg adapter template\n',
    },
    BASE_PATH,
  )
}

const originalFetch = global.fetch
const originalDatabaseUrl = process.env.DATABASE_URL

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vol.reset()
  vi.clearAllMocks()
  delete process.env.DATABASE_URL
  // The handler's success/note paths print via console.log. It's silenced here
  // so test output isn't cluttered with the Neon claim message and similar.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      connection_string: 'postgresql://user:pass@ep-abc-pooler.neon.tech/db',
      expires_at: '2027-01-01T00:00:00.000Z',
      claim_url: 'https://neon.new/claim/abc',
    }),
  })) as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
  logSpy.mockRestore()

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl
  }
})

describe('neon handler', () => {
  it('provisions a database, converts the project, and runs migrations', async () => {
    seedSqliteProject()

    await handler({ force: false, migrations: true, verbose: false })

    const prismaSchemaPath = path.join(BASE_PATH, 'api/db/schema.prisma')
    const prismaSchema = memfsFs.readFileSync(prismaSchemaPath, 'utf-8')
    expect(prismaSchema).toContain('provider = "postgresql"')

    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-abc-pooler.neon.tech/db',
    )
    expect(envContent).toContain(
      'DIRECT_DATABASE_URL=postgresql://user:pass@ep-abc.neon.tech/db',
    )

    const prismaConfigPath = path.join(BASE_PATH, 'api/prisma.config.cjs')
    const prismaConfig = memfsFs.readFileSync(prismaConfigPath, 'utf-8')
    expect(prismaConfig).toContain("env('DIRECT_DATABASE_URL')")

    expect(Listr2Mock.executedTaskTitles).toContain('Running Prisma migrations')
  })

  it('provisions and writes .env, but skips migrations, when prisma.config has no recognizable datasource URL', async () => {
    // Provisioning and writing the new connection strings to .env are
    // harmless even if prisma.config couldn't be updated — but running
    // migrations against a datasource we couldn't confirm is now
    // DIRECT_DATABASE_URL could target a database from before this
    // conversion instead, so that's the one thing that must not run.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/prisma.config.cjs'),
      'module.exports = defineConfig({ datasource: { url: someCustomFn() } })',
    )

    await handler({ force: false, migrations: true, verbose: false })

    expect(global.fetch).toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).toContain(
      'Skipping migrations — could not confirm prisma.config is reading ' +
        'DIRECT_DATABASE_URL, so migrations could target the wrong ' +
        'database. Fix datasource.url, then run ' +
        '`yarn cedar prisma migrate dev` manually.',
    )
    expect(commandSync).not.toHaveBeenCalled()

    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-abc-pooler.neon.tech/db',
    )

    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/prisma.config.cjs'),
        'utf-8',
      ),
    ).toContain('url: someCustomFn()')
  })

  it('skips provisioning, env writing, and migrating when DATABASE_URL is already set', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://existing/db\n',
    )

    global.fetch = vi.fn()

    await handler({ force: false })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).toContain('Provisioning Neon database')
    expect(Listr2Mock.skippedTaskTitles).toContain('Running Prisma migrations')
    expect(Listr2Mock.skippedTaskTitles).toContain(
      'Setting DIRECT_DATABASE_URL in Prisma config',
    )

    // The schema/adapter conversion is independent of whether DATABASE_URL
    // is already set — it only cares whether the project is still on
    // SQLite — so it still runs here even though provisioning is skipped.
    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/db/schema.prisma'),
        'utf-8',
      ),
    ).toContain('provider = "postgresql"')

    expect(memfsFs.readFileSync(path.join(BASE_PATH, '.env'), 'utf-8')).toBe(
      'DATABASE_URL=postgresql://existing/db\n',
    )

    // No DIRECT_DATABASE_URL was ever written in this path — rewriting
    // prisma.config to read it would leave the project pointed at an
    // undefined env var.
    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/prisma.config.cjs'),
        'utf-8',
      ),
    ).toContain("env('DATABASE_URL')")
  })

  it('provisions when the existing DATABASE_URL is a SQLite file: path', async () => {
    // A `file:` DATABASE_URL (e.g. carried over from .env.defaults) is not
    // an already-configured Postgres connection string, so it must not
    // trip the "already set" skip.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=file:./db/dev.db\n',
    )

    await handler({ force: false, migrations: true, verbose: false })

    expect(global.fetch).toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).not.toContain(
      'Provisioning Neon database',
    )

    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-abc-pooler.neon.tech/db',
    )
    // The stale `file:` entry must be replaced, not left in place alongside
    // the new one — otherwise the next run would match it again and
    // provision yet another database.
    expect(envContent.match(/^DATABASE_URL=/gm)).toHaveLength(1)
  })

  it('provisions when the existing DATABASE_URL is blank', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(path.join(BASE_PATH, '.env'), 'DATABASE_URL=\n')

    await handler({ force: false, migrations: true, verbose: false })

    expect(global.fetch).toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).not.toContain(
      'Provisioning Neon database',
    )

    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-abc-pooler.neon.tech/db',
    )
    expect(envContent.match(/^DATABASE_URL=/gm)).toHaveLength(1)
  })

  it('provisions when the existing DATABASE_URL is protocol-only with no host', async () => {
    // `postgres://` and `postgresql://` alone parse as valid URLs (per
    // `new URL()`) but have no host, so they're not usable connection
    // strings — this must not be mistaken for "already configured".
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgres://\n',
    )

    await handler({ force: false, migrations: true, verbose: false })

    expect(global.fetch).toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).not.toContain(
      'Provisioning Neon database',
    )

    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-abc-pooler.neon.tech/db',
    )
    expect(envContent.match(/^DATABASE_URL=/gm)).toHaveLength(1)
  })

  it('skips provisioning when the existing DATABASE_URL is quoted', async () => {
    // `readEnvVar` (used by the generic Postgres setup path) treats a
    // quoted value as set without stripping the quotes, so the Neon
    // detection needs to recognize the same shape rather than rejecting it
    // on the leading `"`.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL="postgresql://existing/db"\n',
    )

    global.fetch = vi.fn()

    await handler({ force: false })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).toContain('Provisioning Neon database')
  })

  it('provisions again with --force even when DATABASE_URL is already set', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://existing/db\n',
    )

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        connection_string: 'postgresql://user:pass@ep-new-pooler.neon.tech/db',
        expires_at: '2027-01-01T00:00:00.000Z',
        claim_url: 'https://neon.new/claim/new',
      }),
    })) as unknown as typeof fetch

    await handler({ force: true, migrations: true, verbose: false })

    expect(global.fetch).toHaveBeenCalled()
    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-new-pooler.neon.tech/db',
    )
    expect(envContent).not.toContain('postgresql://existing/db')
  })

  it('bails on an unsupported provider and does nothing else', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      'datasource db {\n  provider = "mysql"\n}\n',
    )

    global.fetch = vi.fn()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ force: false })).rejects.toThrow(
      'process.exit called',
    )

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(memfsFs.existsSync(path.join(BASE_PATH, '.env'))).toBe(false)

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('reports a friendly message and exits cleanly when already converted', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      POSTGRES_SCHEMA,
    )
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/src/lib/db.ts'),
      'import { PrismaPg } from "@prisma/adapter-pg"',
    )

    global.fetch = vi.fn()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await handler({ force: false })

    expect(exitSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('already configured for PostgreSQL'),
    )
    expect(global.fetch).not.toHaveBeenCalled()

    exitSpy.mockRestore()
  })

  it('exits with a non-zero status when the migration fails, and never writes .env', async () => {
    // Migrations run before .env is written, and `exitOnError: true` stops
    // the list on the first failure — so a migration failure must leave
    // .env untouched. Otherwise the project would be left pointing at a
    // real, soon-to-expire Neon database without ever telling the
    // developer they need to claim it.
    seedSqliteProject()

    commandSync.mockReturnValueOnce({
      exitCode: 1,
      stderr: 'P1013: connection failed',
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      handler({ force: false, migrations: true, verbose: false }),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Prisma migration failed'),
    )
    expect(memfsFs.existsSync(path.join(BASE_PATH, '.env'))).toBe(false)

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('exits with an error instead of prompting when migrations is omitted in a non-interactive terminal', async () => {
    seedSqliteProject()

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // vitest doesn't run with a TTY attached to stdin, so omitting
    // `migrations` here exercises the same non-interactive guard a real
    // CI/script invocation would hit.
    await expect(handler({ force: false, verbose: false })).rejects.toThrow(
      'process.exit called',
    )

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot prompt for confirmation in a non-interactive terminal',
      ),
    )
    expect(commandSync).not.toHaveBeenCalled()
    // Provisioning itself never got a chance to run either, since the
    // guard fires before the task list is even built.
    expect(global.fetch).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('skips migrations without prompting when --no-migrations is passed, but still provisions and writes .env', async () => {
    seedSqliteProject()

    await handler({ force: false, migrations: false, verbose: false })

    expect(global.fetch).toHaveBeenCalled()
    expect(commandSync).not.toHaveBeenCalled()
    expect(Listr2Mock.skippedTaskTitles).toContain('Skipped (--no-migrations)')

    const envContent = memfsFs.readFileSync(
      path.join(BASE_PATH, '.env'),
      'utf-8',
    )
    expect(envContent).toContain(
      'DATABASE_URL=postgresql://user:pass@ep-abc-pooler.neon.tech/db',
    )
  })

  it('runs migrations with inherited stdio and a shorter error message when --verbose is passed', async () => {
    seedSqliteProject()

    commandSync.mockReturnValueOnce({ exitCode: 1, stderr: 'P1013: boom' })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      handler({ force: false, migrations: true, verbose: true }),
    ).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Prisma migration failed. You can try running'),
    )
    // The verbose error message doesn't repeat captured stderr - inherited
    // stdio already streamed it straight to the terminal.
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('boom'))

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
