vi.mock('node:fs')

import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

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

const BASE_PATH = '/path/to/project'

vi.mock('@cedarjs/cli-helpers', () => ({
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
  getPaths: () => ({
    base: BASE_PATH,
    api: {
      base: path.join(BASE_PATH, 'api'),
      src: path.join(BASE_PATH, 'api', 'src'),
    },
    scripts: path.join(BASE_PATH, 'scripts'),
  }),
  installPackages: { title: 'Installing packages...', task: async () => {} },
}))

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

    await handler({ force: false })

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

    await handler({ force: true })

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

  it('exits with a non-zero status when the migration fails, instead of reporting success', async () => {
    // With `exitOnError: false`, a failed task doesn't reject `tasks.run()` and
    // that's the mechanism this command relies on to let "One more thing..."
    // still print even when something upstream fails. Without explicitly
    // checking `tasks.errors` afterwards, that silently swallows the upstream
    // failure and this command exits 0.
    seedSqliteProject()

    commandSync.mockReturnValueOnce({
      exitCode: 1,
      stderr: 'P1013: connection failed',
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ force: false })).rejects.toThrow(
      'process.exit called',
    )

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Prisma migration failed'),
    )

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
