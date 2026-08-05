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

vi.mock('listr2', () => ({
  Listr: Listr2Mock,
}))

const commandSync = vi.fn((..._args: unknown[]) => ({
  exitCode: 0,
  stderr: '',
}))
vi.mock('execa', () => ({
  default: {
    commandSync: (...args: unknown[]) => commandSync(...args),
  },
}))

const addWorkspacePackages = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@cedarjs/cli-helpers/packageManager/packages', () => ({
  addWorkspacePackages: (...args: unknown[]) => addWorkspacePackages(...args),
}))

const BASE_PATH = '/path/to/project'

const getPaths = () => ({
  base: BASE_PATH,
  api: {
    base: path.join(BASE_PATH, 'api'),
    src: path.join(BASE_PATH, 'api', 'src'),
  },
  scripts: path.join(BASE_PATH, 'scripts'),
})

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
  getPaths: () => getPaths(),
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

const originalDatabaseUrl = process.env.DATABASE_URL
const originalDirectDatabaseUrl = process.env.DIRECT_DATABASE_URL

beforeEach(() => {
  vol.reset()
  vi.clearAllMocks()
  delete process.env.DATABASE_URL
  delete process.env.DIRECT_DATABASE_URL
})

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl
  }

  if (originalDirectDatabaseUrl === undefined) {
    delete process.env.DIRECT_DATABASE_URL
  } else {
    process.env.DIRECT_DATABASE_URL = originalDirectDatabaseUrl
  }
})

describe('checkProjectShape', () => {
  it('accepts an untouched SQLite project', () => {
    seedSqliteProject()

    const shape = checkProjectShape(getPaths())

    expect(shape.ok).toBe(true)
    if (shape.ok) {
      expect(shape.prismaConfigPath).toBe(
        path.join(BASE_PATH, 'api/prisma.config.cjs'),
      )
    }
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

    const shape = checkProjectShape(getPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: true })
  })

  it('blocks on an unsupported database provider', () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/db/schema.prisma'),
      'datasource db {\n  provider = "mysql"\n}\n',
    )

    const shape = checkProjectShape(getPaths())

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

    const shape = checkProjectShape(getPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
  })

  it('blocks when no Prisma config file exists', () => {
    seedSqliteProject()
    memfsFs.unlinkSync(path.join(BASE_PATH, 'api/prisma.config.cjs'))

    const shape = checkProjectShape(getPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
    if (!shape.ok) {
      expect(shape.message).toContain('No Prisma config file found')
    }
  })

  it('blocks when the Prisma config has no recognizable datasource URL', () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/prisma.config.cjs'),
      'module.exports = defineConfig({ datasourceUrl: databaseUrl })',
    )

    const shape = checkProjectShape(getPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
    if (!shape.ok) {
      expect(shape.message).toContain(
        "Could not find an active `url: env('DATABASE_URL')` line",
      )
    }
  })

  it('blocks when SQLite is used outside db.ts, in api/src', () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/src/some-script.ts'),
      "import 'better-sqlite3'",
    )

    const shape = checkProjectShape(getPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
  })

  it('blocks when SQLite is used outside db.ts, in the project scripts/ dir', () => {
    seedSqliteProject()
    memfsFs.mkdirSync(path.join(BASE_PATH, 'scripts'), { recursive: true })
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'scripts/import-sqlite.ts'),
      "import 'better-sqlite3'",
    )

    const shape = checkProjectShape(getPaths())

    expect(shape).toMatchObject({ ok: false, alreadyConverted: false })
  })
})

describe('getSqliteToPostgresTasks', () => {
  it('converts a SQLite project to PostgreSQL', async () => {
    seedSqliteProject()

    const shape = checkProjectShape(getPaths())
    if (!shape.ok) {
      throw new Error('Expected a convertible project shape')
    }

    const tasks = getSqliteToPostgresTasks({
      prismaConfigPath: shape.prismaConfigPath,
    })
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

  it('rewrites the datasource URL even when a comment elsewhere mentions DIRECT_DATABASE_URL', async () => {
    // The detection and rewrite are both anchored on the `url:` key
    // specifically. A naive whole-file search for the text
    // `env('DIRECT_DATABASE_URL')` would read this comment as "already
    // converted" and skip the real rewrite below it, leaving the schema
    // switched to PostgreSQL but migrations still pointed at DATABASE_URL.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/prisma.config.cjs'),
      "// See env('DIRECT_DATABASE_URL') in the docs\n" +
        "module.exports = defineConfig({ datasource: { url: env('DATABASE_URL') } })",
    )

    const shape = checkProjectShape(getPaths())
    if (!shape.ok) {
      throw new Error('Expected a convertible project shape')
    }

    const tasks = getSqliteToPostgresTasks({
      prismaConfigPath: shape.prismaConfigPath,
    })
    await new Listr2Mock(tasks).run()

    expect(
      memfsFs.readFileSync(
        path.join(BASE_PATH, 'api/prisma.config.cjs'),
        'utf-8',
      ),
    ).toContain("url: env('DIRECT_DATABASE_URL')")
  })

  it('rewrites the active datasource URL, even past a commented-out example of the same shape', async () => {
    // A comment can reproduce the exact `url: env(...)` shape it's
    // describing, not just mention the env var name in prose — the
    // detection and rewrite both have to skip past commented-out lines
    // entirely, not just avoid a same-file substring search.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, 'api/prisma.config.cjs'),
      "// e.g. datasource: { url: env('DIRECT_DATABASE_URL') }\n" +
        "module.exports = defineConfig({ datasource: { url: env('DATABASE_URL') } })",
    )

    const shape = checkProjectShape(getPaths())
    if (!shape.ok) {
      throw new Error('Expected a convertible project shape')
    }

    const tasks = getSqliteToPostgresTasks({
      prismaConfigPath: shape.prismaConfigPath,
    })
    await new Listr2Mock(tasks).run()

    const configContent = memfsFs.readFileSync(
      path.join(BASE_PATH, 'api/prisma.config.cjs'),
      'utf-8',
    ) as string
    expect(configContent).toContain(
      "datasource: { url: env('DIRECT_DATABASE_URL') }",
    )
    // The comment itself must survive untouched.
    expect(configContent).toContain(
      "// e.g. datasource: { url: env('DIRECT_DATABASE_URL') }",
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

  it('defaults DIRECT_DATABASE_URL to DATABASE_URL when only one is set', async () => {
    // prisma.config gets rewritten to read migrations from
    // DIRECT_DATABASE_URL, not DATABASE_URL. Most providers only hand out
    // one connection string, so without this, migrations would have
    // nothing to connect with even though DATABASE_URL is set.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://localhost/app\n',
    )

    await handler()

    expect(commandSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        env: expect.objectContaining({
          DIRECT_DATABASE_URL: 'postgresql://localhost/app',
        }),
      }),
    )
  })

  it('prefers an explicitly set DIRECT_DATABASE_URL over DATABASE_URL', async () => {
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://localhost/app-pooled\n' +
        'DIRECT_DATABASE_URL=postgresql://localhost/app-direct\n',
    )

    await handler()

    expect(commandSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        env: expect.objectContaining({
          DIRECT_DATABASE_URL: 'postgresql://localhost/app-direct',
        }),
      }),
    )
  })

  it('falls back to DATABASE_URL when DIRECT_DATABASE_URL is blank', async () => {
    // `NAME=` (empty value) has to be treated the same as NAME being absent
    // — `??` alone stops at `''` without falling through to DATABASE_URL,
    // so the migration subprocess would get DIRECT_DATABASE_URL='' instead
    // of a usable connection string.
    seedSqliteProject()
    memfsFs.writeFileSync(
      path.join(BASE_PATH, '.env'),
      'DATABASE_URL=postgresql://localhost/app\nDIRECT_DATABASE_URL=\n',
    )

    await handler()

    expect(commandSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        env: expect.objectContaining({
          DIRECT_DATABASE_URL: 'postgresql://localhost/app',
        }),
      }),
    )
  })

  it('exits with a non-zero status when the migration fails, instead of reporting success', async () => {
    // With `exitOnError: false`, a failed task doesn't reject `tasks.run()`
    // — that's the mechanism this command relies on to let the closing
    // notes still print even when something upstream fails. Without
    // explicitly checking `tasks.errors` afterwards, that silently
    // swallows the failure and this command exits 0.
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
