vi.mock('node:fs')

import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
import { vi, describe, it, expect, beforeEach } from 'vitest'

import type { getPaths } from "@cedarjs/cli-helpers/paths";
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

const addWorkspacePackages = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@cedarjs/cli-helpers/packageManager/packages', () => ({
  addWorkspacePackages: (...args: unknown[]) => addWorkspacePackages(...args),
}))

vi.mock('@cedarjs/cli-helpers/packageManager', () => ({
  prettyPrintCedarCommand: (args: string[] = []) =>
    `yarn cedar ${args.join(' ')}`,
}))

const BASE_PATH = '/path/to/project'

function mockPaths() {
  return {
    base: BASE_PATH,
    api: {
      base: path.join(BASE_PATH, 'api'),
      src: path.join(BASE_PATH, 'api', 'src'),
      lib: path.join(BASE_PATH, 'api', 'src', 'lib'),
    },
    scripts: path.join(BASE_PATH, 'scripts'),
    // only mocking the paths we actually use
  } as ReturnType<typeof getPaths>
}

vi.mock('@cedarjs/cli-helpers/colors', () => ({
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
}))

vi.mock('@cedarjs/cli-helpers/paths', () => ({
  getPaths: () => mockPaths(),
}))

vi.mock('@cedarjs/cli-helpers/installHelpers', () => ({
  installPackages: { title: 'Installing packages...', task: async () => {} },
}))

const { checkProjectShape, getSqliteToPostgresTasks, handler } =
  await import('../postgresHandler.js')

const SQLITE_SCHEMA = 'datasource db {\n  provider = "sqlite"\n}\n'
const POSTGRES_SCHEMA = 'datasource db {\n  provider = "postgresql"\n}\n'
const PG_DB_TS_TEMPLATE = '// pg adapter template\n'

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
      [path.join(__dirname, '../templates/db.ts.template')]: PG_DB_TS_TEMPLATE,
    },
    BASE_PATH,
  )
}

beforeEach(() => {
  vol.reset()
  vi.clearAllMocks()
})

describe('checkProjectShape', () => {
  it('accepts an untouched SQLite project', () => {
    seedSqliteProject()

    const shape = checkProjectShape(mockPaths())

    expect(shape).toMatchObject({ ok: true })
  })

  it('reports the project as already converted when schema and adapter both say PostgreSQL', () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      POSTGRES_SCHEMA,
    )
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/src/lib/db.ts'),
      'import { PrismaPg } from "@prisma/adapter-pg"',
    )

    const shape = checkProjectShape(mockPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: true })
  })

  it('blocks on an unsupported database provider', () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      'datasource db {\n  provider = "mysql"\n}\n',
    )

    const shape = checkProjectShape(mockPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
    if (!shape.ok) {
      expect(shape.message).toContain(
        'only converts a project that is still on SQLite',
      )
    }
  })

  it('blocks a partial conversion — db.ts already switched, schema still SQLite', () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/src/lib/db.ts'),
      'import { PrismaPg } from "@prisma/adapter-pg"',
    )

    const shape = checkProjectShape(mockPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
  })
})

describe('getSqliteToPostgresTasks', () => {
  it('converts a SQLite project to PostgreSQL', async () => {
    seedSqliteProject()

    const shape = checkProjectShape(mockPaths())
    if (!shape.ok) {
      throw new Error('Expected a convertible project shape')
    }

    const tasks = getSqliteToPostgresTasks({ dbPath: shape.dbPath })
    await new Listr2Mock(tasks).run()

    const apiPkg = JSON.parse(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/package.json'),
        'utf-8',
      ) as string,
    )
    expect(apiPkg.dependencies['better-sqlite3']).toBeUndefined()
    expect(
      apiPkg.dependencies['@prisma/adapter-better-sqlite3'],
    ).toBeUndefined()

    const rootPkg = JSON.parse(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'package.json'),
        'utf-8',
      ) as string,
    )
    expect(rootPkg.dependenciesMeta).toBeUndefined()

    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/db/schema.prisma'),
        'utf-8',
      ),
    ).toBe(POSTGRES_SCHEMA)

    expect(
      memfsFs.readFileSync(path.join(BASE_PATH, 'api/src/lib/db.ts'), 'utf-8'),
    ).toBe(PG_DB_TS_TEMPLATE)

    // The generic Postgres command doesn't touch prisma.config — a single
    // connection string is enough, so it's left reading DATABASE_URL as-is.
    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/prisma.config.cjs'),
        'utf-8',
      ),
    ).toContain("env('DATABASE_URL')")

    expect(addWorkspacePackages).toHaveBeenCalledWith(
      'api',
      ['@prisma/adapter-pg@7.8.0'],
      { cwd: path.join(BASE_PATH, 'api') },
    )
  })
})

describe('postgres handler', () => {
  it('bails without mutating anything when the project shape is not convertible', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      'datasource db {\n  provider = "mysql"\n}\n',
    )

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler()).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'only converts a project that is still on SQLite',
      ),
    )
    expect(commandSync).not.toHaveBeenCalled()
    expect(addWorkspacePackages).not.toHaveBeenCalled()
    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/db/schema.prisma'),
        'utf-8',
      ),
    ).toBe('datasource db {\n  provider = "mysql"\n}\n')

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

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await handler()

    expect(exitSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('already configured for PostgreSQL'),
    )
    expect(commandSync).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('skips running migrations when DATABASE_URL is not set', async () => {
    seedSqliteProject()

    await handler()

    expect(Listr2Mock.skippedTaskTitles).toContain(
      'No DATABASE_URL found in `.env`. Set it to your PostgreSQL ' +
        'connection string, then run `yarn cedar prisma migrate dev`',
    )
  })

  it('runs migrations when DATABASE_URL is set', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://localhost/app\n',
    )

    await handler()

    expect(Listr2Mock.executedTaskTitles).toContain('Running Prisma migrations')
  })

  it('exits with a non-zero status when the migration fails, instead of reporting success', async () => {
    // With `exitOnError: false`, a failed task doesn't reject `tasks.run()` and
    // that's the mechanism this command relies on to let the closing notes
    // still print even when something upstream fails. Without explicitly
    // checking `tasks.errors` afterwards, that silently swallows the failure
    // and this command exits 0.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://localhost/app\n',
    )
    commandSync.mockReturnValueOnce({
      exitCode: 1,
      stderr: 'P1013: connection failed',
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler()).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Prisma migration failed'),
    )

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
