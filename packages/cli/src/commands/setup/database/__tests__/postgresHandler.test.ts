vi.mock('node:fs')

import path from 'node:path'

import { vol, fs as memfsFs } from 'memfs'
import { vi, describe, it, expect, beforeEach } from 'vitest'

import '../../../../lib/mockTelemetry.js'

import { globSyncByExtension } from '../../../../__tests__/globSyncStub.js'
import { Listr2Mock } from '../../../../__tests__/Listr2Mock.js'

vi.mock('node:fs', async () => ({
  ...memfsFs,
  default: { ...memfsFs },
  globSync: (_pattern: string, opts: { cwd: string }) =>
    globSyncByExtension(opts.cwd, ['ts', 'tsx', 'js', 'jsx']),
}))

vi.mock('listr2', () => ({
  Listr: Listr2Mock,
}))

vi.mock('execa', () => ({
  default: {
    commandSync: vi.fn(() => ({ exitCode: 0, stderr: '' })),
  },
}))

const addWorkspacePackages = vi.fn(async () => {})
vi.mock('@cedarjs/cli-helpers/packageManager/packages', () => ({
  addWorkspacePackages: (...args: unknown[]) => addWorkspacePackages(...args),
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
  }),
  installPackages: { title: 'Installing packages...', task: async () => {} },
}))

const { getSqliteToPostgresTasks, handler } =
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
        "module.exports = defineConfig({ datasourceUrl: env('DATABASE_URL') })",
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

describe('getSqliteToPostgresTasks', () => {
  it('converts a SQLite project to PostgreSQL', async () => {
    seedSqliteProject()

    const notes: string[] = []
    const tasks = getSqliteToPostgresTasks({ notes })
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

    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/prisma.config.cjs'),
        'utf-8',
      ),
    ).toContain("env('DIRECT_DATABASE_URL')")

    expect(addWorkspacePackages).toHaveBeenCalledWith(
      'api',
      ['@prisma/adapter-pg@7.8.0'],
      { cwd: path.join(BASE_PATH, 'api') },
    )
  })

  it('is idempotent when the project is already PostgreSQL', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      POSTGRES_SCHEMA,
    )
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/src/lib/db.ts'),
      'import { PrismaPg } from "@prisma/adapter-pg"',
    )

    const notes: string[] = []
    const tasks = getSqliteToPostgresTasks({ notes })
    await new Listr2Mock(tasks).run()

    expect(Listr2Mock.skippedTaskTitles).toEqual(
      expect.arrayContaining([
        'Already configured for PostgreSQL',
        'Schema is already configured for PostgreSQL',
        'Database adapter is already configured for PostgreSQL (PrismaPg)',
        'Prisma config is already configured for PostgreSQL',
      ]),
    )
    expect(addWorkspacePackages).not.toHaveBeenCalled()
  })

  it('skips everything and notes an unsupported provider', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      'datasource db {\n  provider = "mysql"\n}\n',
    )

    const notes: string[] = []
    const tasks = getSqliteToPostgresTasks({ notes })
    await new Listr2Mock(tasks).run()

    expect(notes.join('\n')).toContain(
      'only supports migrating from SQLite to PostgreSQL',
    )
    expect(addWorkspacePackages).not.toHaveBeenCalled()
  })

  it('keeps SQLite packages installed when they are used outside db.ts', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/src/some-script.ts'),
      "import 'better-sqlite3'",
    )

    const notes: string[] = []
    const tasks = getSqliteToPostgresTasks({ notes })
    await new Listr2Mock(tasks).run()

    const apiPkg = JSON.parse(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/package.json'),
        'utf-8',
      ) as string,
    )
    expect(apiPkg.dependencies['better-sqlite3']).toBe('1.0.0')
  })
})

describe('postgres handler', () => {
  it('skips running migrations when DATABASE_URL is not set', async () => {
    seedSqliteProject()

    await handler()

    expect(Listr2Mock.skippedTaskTitles).toContain(
      'No DATABASE_URL found in .env — set it to your PostgreSQL ' +
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
})
