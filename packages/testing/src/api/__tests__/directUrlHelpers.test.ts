import path from 'node:path'

import { fs as memfs, vol } from 'memfs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkAndReplaceDirectUrl, getDefaultDb } from '../directUrlHelpers.js'

vi.mock('node:fs', () => ({ ...memfs, default: memfs }))

vi.mock('@prisma/config', () => ({
  default: {
    loadConfigFromFile: async ({ configRoot }: { configRoot: string }) => {
      const configPath = path.join(configRoot, 'prisma.config.cjs')

      console.log('configPath', configPath)

      return JSON.parse(memfs.readFileSync(configPath).toString())
    },
  },
}))

vi.mock('@prisma/internals', () => ({
  default: {
    getSchemaWithPath: vi.fn().mockImplementation((schemaPath: string) => {
      return {
        schemas: [[schemaPath, memfs.readFileSync(schemaPath, 'utf8')]],
      }
    }),
  },
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => {
    return {
      base: 'test-project',
      api: {
        base: path.join('test-project', 'api'),
        prismaConfig: path.join('test-project', 'api', 'prisma.config.cjs'),
      },
    }
  },
  getSchemaPath: async (prismaConfigPath: string) => {
    return path.join(path.dirname(prismaConfigPath), 'db', 'schema.prisma')
  },
}))

describe('directUrlHelpers', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
    delete process.env.DIRECT_URL
    delete process.env.TEST_DIRECT_URL
    delete process.env.TEST_DATABASE_URL
  })

  afterEach(() => {
    vol.reset()
    delete process.env.DIRECT_URL
    delete process.env.TEST_DIRECT_URL
    delete process.env.TEST_DATABASE_URL
  })

  it("does nothing if directUrl isn't set", async () => {
    const prismaSchema = `datasource db {
      provider          = "sqlite"
      url               = env("DATABASE_URL")
    }`

    vol.fromJSON(
      {
        'cedar.toml': '',
        'api/prisma.config.cjs': '{}',
        'api/db/schema.prisma': prismaSchema,
      },
      'test-project',
    )

    await checkAndReplaceDirectUrl()

    expect(process.env.DIRECT_URL).toBeUndefined()
  })

  it("overwrites directUrl if it's set", async () => {
    const prismaSchema = `datasource db {
      provider = "sqlite"
      url = env("DATABASE_URL")
      directUrl = env("DIRECT_URL")
    }`

    vol.fromJSON(
      {
        'cedar.toml': '',
        'api/prisma.config.cjs': '{}',
        'api/db/schema.prisma': prismaSchema,
      },
      'test-project',
    )

    const defaultDb = getDefaultDb('test-project')
    const directUrlEnvVar = await checkAndReplaceDirectUrl()

    if (!directUrlEnvVar) {
      expect.fail('directUrlEnvVar is not defined')
    } else {
      expect(process.env[directUrlEnvVar]).toBe(defaultDb)
    }
  })

  // From https://github.com/redwoodjs/graphql/pull/8001
  it("overwrites directUrl if it's set and formatted", async () => {
    const prismaSchema = `datasource db {
      provider          = "sqlite"
      url               = env("DATABASE_URL")
      directUrl         = env("DIRECT_URL")
      shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
    }`

    vol.fromJSON(
      {
        'cedar.toml': '',
        'api/prisma.config.cjs': '{}',
        'api/db/schema.prisma': prismaSchema,
      },
      'test-project',
    )

    const defaultDb = getDefaultDb('test-project')
    const directUrlEnvVar = await checkAndReplaceDirectUrl()

    if (!directUrlEnvVar) {
      expect.fail('directUrlEnvVar is not defined')
    } else {
      expect(process.env[directUrlEnvVar]).toBe(defaultDb)
    }
  })

  it('Reads url from Prisma config if set', async () => {
    const prismaSchema = `datasource db {
      provider          = "sqlite"
      url               = env("DATABASE_URL")
    }`

    const prismaConfig = `{
      "datasource": {
        "url": "process.env.DIRECT_URL"
      }
    }`

    vol.fromJSON(
      {
        'cedar.toml': '',
        'api/prisma.config.cjs': prismaConfig,
        'api/db/schema.prisma': prismaSchema,
      },
      'test-project',
    )

    await checkAndReplaceDirectUrl()

    expect(process.env.DIRECT_URL).toBeUndefined()
  })
})
