import { vol, fs as memfs } from 'memfs'
import {
  vi,
  expect,
  describe,
  it,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest'

import { getPaths } from '@cedarjs/project-config'
import type ProjectConfig from '@cedarjs/project-config'

import {
  handler,
  NO_PENDING_MIGRATIONS_MESSAGE,
} from '../commands/upHandlerEsm'

vi.mock('fs', async () => ({ ...memfs, default: memfs }))
vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('@cedarjs/project-config', async () => {
  const actual = await vi.importActual<typeof ProjectConfig>(
    '@cedarjs/project-config',
  )

  return {
    ...actual,
    getPaths: () => ({
      base: '/redwood-app',
      api: {
        base: '/redwood-app/api',
        dataMigrations: '/redwood-app/api/db/dataMigrations',
        db: '/redwood-app/api/db',
        prismaConfig: '/redwood-app/api/prisma.config.cjs',
        dist: '/redwood-app/api/dist',
        lib: '/redwood-app/api/dist/lib',
      },
      web: {
        base: '/redwood-app/web',
      },
    }),
    getDataMigrationsPath: async () => '/redwood-app/api/db/dataMigrations',
  }
})

// ─── Mocks ───────────────────────────────────────────────────────────────────

const redwoodProjectPath = '/redwood-app'

let consoleLogMock: ReturnType<typeof vi.spyOn>
let consoleInfoMock: ReturnType<typeof vi.spyOn>
let consoleErrorMock: ReturnType<typeof vi.spyOn>
let consoleWarnMock: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => {})
  consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogMock.mockRestore()
  consoleInfoMock.mockRestore()
  consoleErrorMock.mockRestore()
  consoleWarnMock.mockRestore()
})

const mockDataMigrations: { current: any[] } = { current: [] }

vi.mock('bundle-require', () => {
  return {
    bundleRequire: ({ filepath }: { filepath: string }) => {
      return {
        mod: {
          default: () => {
            if (filepath.endsWith('20230822075443-wip.ts')) {
              throw new Error('oops')
            }
          },
        },
      }
    },
  }
})

vi.mock('/redwood-app/api/dist/lib/db.js', () => {
  return {
    db: {
      rW_DataMigration: {
        create(dataMigration) {
          mockDataMigrations.current.push(dataMigration)
        },
        findMany() {
          return mockDataMigrations.current
        },
      },
      $disconnect: () => {},
    },
  }
})

vi.mock(`\\redwood-app\\api\\dist\\lib\\db.js`, () => {
  return {
    db: {
      rW_DataMigration: {
        create(dataMigration) {
          mockDataMigrations.current.push(dataMigration)
        },
        findMany() {
          return mockDataMigrations.current
        },
      },
      $disconnect: () => {},
    },
  }
})

const RWJS_CWD = process.env.RWJS_CWD

beforeAll(() => {
  process.env.RWJS_CWD = redwoodProjectPath
})

afterEach(() => {
  vol.reset()
  mockDataMigrations.current = []
})

afterAll(() => {
  process.env.RWJS_CWD = RWJS_CWD
})

const ranDataMigration = {
  version: '20230822075441',
  name: '20230822075441-wip.ts',
  startedAt: '2023-08-22T07:55:16.292Z',
  finishedAt: '2023-08-22T07:55:16.292Z',
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('upHandler', () => {
  it("noops if there's no data migrations directory", async () => {
    vol.fromNestedJSON(
      {
        'redwood.toml': '',
        api: {
          dist: {
            lib: {
              'db.js': '',
            },
          },
          db: {
            // No dataMigrations dir:
            //
            // dataMigrations: {
            //   [ranDataMigration.name]: '',
            // },
          },
        },
      },
      redwoodProjectPath,
    )

    await handler({
      importDbClientFromDist: true,
      distPath: getPaths().api.dist,
    })

    expect(consoleInfoMock.mock.calls[0][0]).toMatch(
      NO_PENDING_MIGRATIONS_MESSAGE,
    )
  })

  it('noops if there are no pending migrations', async () => {
    mockDataMigrations.current = [ranDataMigration]

    vol.fromNestedJSON(
      {
        'redwood.toml': '',
        api: {
          dist: {
            lib: {
              'db.js': '',
            },
          },
          db: {
            dataMigrations: {
              [ranDataMigration.name]: '',
            },
          },
        },
      },
      redwoodProjectPath,
    )

    await handler({
      importDbClientFromDist: true,
      distPath: getPaths().api.dist,
    })

    expect(consoleInfoMock.mock.calls[0][0]).toMatch(
      NO_PENDING_MIGRATIONS_MESSAGE,
    )
  })

  it('runs pending migrations', async () => {
    mockDataMigrations.current = [
      {
        version: '20230822075441',
        name: '20230822075441-wip.ts',
        startedAt: '2023-08-22T07:55:16.292Z',
        finishedAt: '2023-08-22T07:55:16.292Z',
      },
    ]

    vol.fromNestedJSON(
      {
        'redwood.toml': '',
        api: {
          dist: {
            lib: {
              'db.js': '',
            },
          },
          db: {
            dataMigrations: {
              '20230822075442-wip.ts': '',
              '20230822075443-wip.ts': '',
              '20230822075444-wip.ts': '',
            },
          },
        },
      },
      redwoodProjectPath,
    )

    await handler({
      importDbClientFromDist: true,
      distPath: getPaths().api.dist,
    })

    // The handler will error and set the exit code to 1, we must revert that
    // or test suite itself will fail.
    process.exitCode = 0

    expect(consoleInfoMock.mock.calls[0][0]).toMatch(
      '1 data migration(s) completed successfully.',
    )
    expect(consoleErrorMock.mock.calls[1][0]).toMatch(
      '1 data migration(s) exited with errors.',
    )
    expect(consoleWarnMock.mock.calls[0][0]).toMatch(
      '1 data migration(s) skipped due to previous error',
    )
  })
})
