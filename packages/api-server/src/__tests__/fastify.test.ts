import path from 'node:path'

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
const FIXTURE_PATH = path.join(
  import.meta.dirname,
  'fixtures/graphql/cedar-app',
)

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

// The fixture's server.config.js is a real file, so the module runner can
// resolve the dynamic import in fastify.ts. Its exports are replaced here
vi.mock('./fixtures/graphql/cedar-app/api/server.config.js', () => {
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
