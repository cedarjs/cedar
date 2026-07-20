import fastify from 'fastify'
import { vol } from 'memfs'
import {
  vi,
  describe,
  afterEach,
  afterAll,
  beforeAll,
  test,
  expect,
  it,
} from 'vitest'

import { createFastifyInstance, DEFAULT_OPTIONS } from '../fastify.js'

// We'll be testing how fastify is instantiated, so we'll mock it here.
vi.mock('fastify', () => {
  return {
    default: vi.fn(() => {
      return {
        register: () => {},
        addHook: () => {},
      }
    }),
  }
})

// Suppress terminal logging.
console.log = vi.fn()

// Set up CEDAR_CWD.
let original_CEDAR_CWD: string | undefined
const FIXTURE_PATH = '/graphql/cedar-app'

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = FIXTURE_PATH
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

// Mock server.config.js to test instantiating fastify with user config.
vi.mock('node:fs', async () => ({ default: (await import('memfs')).fs }))

afterEach(() => {
  vol.reset()
})

const userConfig = {
  requestTimeout: 25_000,
}

const mockedConfigSpecifiers = await vi.hoisted(async () => {
  const path = await import('node:path')
  const url = await import('node:url')

  // Vitest 4's module runner no longer provides the CJS `__dirname` shim in
  // ES module scope, so derive the directory from `import.meta`
  const testDir = path.dirname(url.fileURLToPath(import.meta.url))

  // This will be `D:\` on Windows (or some other drive letter) and `/` on Unix
  const osRoot = path.parse(testDir).root.replace('\\', '/')

  const configPath = osRoot + 'graphql/cedar-app/api/server.config.js'

  return {
    configPath,
    // Vitest 4's module runner resolves the dynamic import in fastify.ts to
    // the file:// URL produced by pathToFileURL(), so the mock has to be
    // registered under that exact specifier as well
    configUrl: url.pathToFileURL(configPath).href,
  }
})

vi.mock(mockedConfigSpecifiers.configPath, () => {
  return {
    default: {
      config: userConfig,
    },
  }
})

vi.mock(mockedConfigSpecifiers.configUrl, () => {
  return {
    default: {
      config: userConfig,
    },
  }
})

describe('createFastifyInstance', () => {
  it('instantiates a fastify instance with default config', async () => {
    vol.fromNestedJSON(
      {
        'redwood.toml': '',
      },
      FIXTURE_PATH,
    )

    await createFastifyInstance()
    expect(fastify).toHaveBeenCalledWith(DEFAULT_OPTIONS)
  })

  it("instantiates a fastify instance with the user's configuration if available", async () => {
    vol.fromNestedJSON(
      {
        'redwood.toml': '',
        api: {
          'server.config.js': '',
        },
      },
      FIXTURE_PATH,
    )

    await createFastifyInstance()
    expect(fastify).toHaveBeenCalledWith(userConfig)
  })
})

test('DEFAULT_OPTIONS configures the log level based on NODE_ENV', () => {
  expect(DEFAULT_OPTIONS).toMatchInlineSnapshot(`
    {
      "logger": {
        "level": "info",
      },
    }
  `)
})
