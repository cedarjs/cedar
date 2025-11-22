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

import { handler, NO_PENDING_MIGRATIONS_MESSAGE } from '../commands/upHandler'

vi.mock('fs', async () => ({ ...memfs, default: memfs }))
vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('@cedarjs/babel-config', async () => {
  return {
    registerApiSideBabelHook: () => {},
  }
})

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
        dbSchema: '/redwood-app/api/db/schema.prisma',
        dist: '/redwood-app/api/dist',
        lib: '/redwood-app/api/dist/lib',
      },
      web: {
        base: '/redwood-app/web',
      },
    }),
  }
})

// Mock require() calls for migration files by intercepting Module._load
const requestLog: string[] = []
const { setupRequireMock, restoreRequireMock, mockRequire, getRequestLog } =
  vi.hoisted(() => {
    let Module: any
    let originalLoad: any
    let isSetup = false
    const mocks = new Map<string, any>()

    return {
      setupRequireMock: async () => {
        if (isSetup) {
          return
        }

        // Import using require to get the actual Module object
        const nodeModule = require('node:module')
        Module = nodeModule
        originalLoad = Module._load

        // Wrap the original _load function
        const wrappedLoad = function (
          request: string,
          parent: any,
          isMain: boolean,
        ) {
          // Log all requests that look like migration files
          if (
            request.includes('dataMigrations') ||
            request.includes('wip.ts')
          ) {
            requestLog.push(`REQUEST: ${request}`)
          }

          // Check if any mock matches this request
          for (const [mockPath, mockValue] of mocks.entries()) {
            // Try exact match first
            if (request === mockPath) {
              requestLog.push(`EXACT MATCH: ${request}`)
              return mockValue
            }
            // Then try endsWith for partial paths
            if (request.endsWith(mockPath)) {
              requestLog.push(
                `ENDS_WITH MATCH: ${request} endsWith ${mockPath}`,
              )
              return mockValue
            }
            // Also try matching just the filename
            const requestFilename =
              request.split('/').pop() || request.split('\\').pop()
            const mockFilename =
              mockPath.split('/').pop() || mockPath.split('\\').pop()
            if (requestFilename === mockFilename) {
              requestLog.push(`FILENAME MATCH: ${request} -> ${mockPath}`)
              return mockValue
            }
          }
          return originalLoad.call(this, request, parent, isMain)
        }

        // Copy properties from original function
        Object.setPrototypeOf(wrappedLoad, originalLoad)

        Module._load = wrappedLoad
        isSetup = true
      },
      restoreRequireMock: () => {
        if (Module && originalLoad && isSetup) {
          Module._load = originalLoad
          isSetup = false
        }
        mocks.clear()
      },
      mockRequire: (path: string, stub: any) => {
        mocks.set(path, stub)
        requestLog.push(`MOCK ADDED: ${path}`)
      },
      getRequestLog: () => requestLog,
    }
  })

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

vi.mock('/redwood-app/api/dist/lib/db.js', () => {
  return {
    db: {
      rW_DataMigration: {
        create(dataMigration: any) {
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
        create(dataMigration: any) {
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

vi.mock('/redwood-app/api/db/dataMigrations/20230822075442-wip.ts', () => {
  return { default: () => {} }
})

vi.mock('\\redwood-app\\api\\db\\dataMigrations\\20230822075442-wip.ts', () => {
  return { default: () => {} }
})

vi.mock('/redwood-app/api/db/dataMigrations/20230822075443-wip.ts', () => {
  return {
    default: () => {
      throw new Error('oops')
    },
  }
})

vi.mock('\\redwood-app\\api\\db\\dataMigrations\\20230822075443-wip.ts', () => {
  return {
    default: () => {
      throw new Error('oops')
    },
  }
})

vi.mock('/redwood-app/api/db/dataMigrations/20230822075444-wip.ts', () => {
  return { default: () => {} }
})

vi.mock('\\redwood-app\\api\\db\\dataMigrations\\20230822075444-wip.ts', () => {
  return { default: () => {} }
})

const RWJS_CWD = process.env.RWJS_CWD

beforeAll(() => {
  process.env.RWJS_CWD = redwoodProjectPath
})

afterEach(() => {
  vol.reset()
  mockDataMigrations.current = []
  restoreRequireMock()
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
          'package.json': '{}',
          dist: {
            lib: {
              'db.js': '',
            },
          },
          db: {
            dataMigrations: {
              '20230822075442-wip.ts': 'export default () => {}',
              '20230822075443-wip.ts':
                'export default () => { throw new Error("oops") }',
              '20230822075444-wip.ts': 'export default () => {}',
            },
          },
        },
      },
      redwoodProjectPath,
    )

    // Setup require mocking for migration files
    await setupRequireMock()

    // Mock the three migration files - use just the filename as the key for better matching
    mockRequire('20230822075442-wip.ts', {
      default: () => {},
    })

    mockRequire('20230822075443-wip.ts', {
      default: () => {
        throw new Error('oops')
      },
    })

    mockRequire('20230822075444-wip.ts', {
      default: () => {},
    })

    await handler({
      importDbClientFromDist: true,
      distPath: getPaths().api.dist,
    })

    // Restore require mocking
    restoreRequireMock()

    // The handler will error and set the exit code to 1, we must revert that
    // or test suite itself will fail.
    process.exitCode = 0

    // Debug: Output the request log to see what paths were requested
    const log = getRequestLog()
    if (log.length > 0) {
      // Write to stderr to bypass console mocking
      process.stderr.write('\n=== REQUEST LOG ===\n')
      log.forEach((line) => process.stderr.write(line + '\n'))
      process.stderr.write('===================\n')
    }

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
