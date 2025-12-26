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

// Set up RWJS_CWD.
let original_RWJS_CWD: string | undefined
const FIXTURE_PATH = '/graphql/cedar-app'

beforeAll(() => {
  original_RWJS_CWD = process.env.RWJS_CWD
  process.env.RWJS_CWD = FIXTURE_PATH
})

afterAll(() => {
  process.env.RWJS_CWD = original_RWJS_CWD
})

// Mock server.config.js to test instantiating fastify with user config.
vi.mock('fs', async () => ({ default: (await import('memfs')).fs }))

afterEach(() => {
  vol.reset()
})

const userConfig = {
  requestTimeout: 25_000,
}

const configPath = await vi.hoisted(async () => {
  const path = await import('node:path')

  // This will be `D:\` on Windows (or some other drive letter) and `/` on Unix
  const osRoot = path.parse(__dirname).root.replace('\\', '/')

  return osRoot + 'graphql/cedar-app/api/server.config.js'
})

vi.mock(configPath, () => {
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
