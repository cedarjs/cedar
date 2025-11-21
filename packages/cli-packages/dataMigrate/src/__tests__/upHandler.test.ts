import { vol } from 'memfs'
import { vi, expect, describe, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

import { getPaths } from '@cedarjs/project-config'

import { handler, NO_PENDING_MIGRATIONS_MESSAGE } from '../commands/upHandler'

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

vi.mock(
  '/redwood-app/api/dist/lib/db.js',
  () => {
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
  },
)

vi.mock(
  `\\redwood-app\\api\\dist\\lib\\db.js`,
  () => {
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
  },
)

vi.mock(
  '/redwood-app/api/db/dataMigrations/20230822075442-wip.ts',
  () => {
    return { default: () => {} }
  },
)

vi.mock(
  '\\redwood-app\\api\\db\\dataMigrations\\20230822075442-wip.ts',
  () => {
    return { default: () => {} }
  },
)

vi.mock(
  '/redwood-app/api/db/dataMigrations/20230822075443-wip.ts',
  () => {
    return {
      default: () => {
        throw new Error('oops')
      },
    }
  },
)

vi.mock(
  '\\redwood-app\\api\\db\\dataMigrations\\20230822075443-wip.ts',
  () => {
    return {
      default: () => {
        throw new Error('oops')
      },
    }
  },
)

vi.mock(
  '/redwood-app/api/db/dataMigrations/20230822075444-wip.ts',
  () => {
    return { default: () => {} }
  },
)

vi.mock(
  '\\redwood-app\\api\\db\\dataMigrations\\20230822075444-wip.ts',
  () => {
    return { default: () => {} }
  },
)

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

  it("noops if there's no pending migrations", async () => {
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

  // NOTE: Skipped due to Vitest limitation with CommonJS require() mocking.
  // vi.mock() doesn't intercept require() calls, only ES6 imports.
  // The handler uses require() to load migrations in CommonJS mode.
  // The equivalent test in upHandlerEsm.test.ts passes.
  it.skip('runs pending migrations', async () => {
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
          'package.json': '{}',
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
