import { fs as memfs, vol } from 'memfs'
import { dedent } from 'ts-dedent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => {
  const mockedFs = {
    ...memfs,
    promises: {
      ...memfs.promises,
    },
  }

  return {
    ...mockedFs,
    default: mockedFs,
  }
})

vi.mock('@cedarjs/project-config', () => {
  return {
    getPaths: () => ({
      api: {
        dbSchema: '/app/api/db/schema.prisma',
        base: '/app/api',
        lib: '/app/api/src/lib',
        prismaConfig: '/app/api/prisma.config.cjs',
      },
      base: '/app',
    }),
    ensurePosixPath: (p: string) => p.replace(/\\/g, '/'),
  }
})

import {
  transformPrismaConfig,
  updatePrismaConfig,
} from '../updatePrismaConfig.js'

const OLD_CONFIG = dedent`
  const { defineConfig } = require('prisma/config')

  module.exports = defineConfig({
    schema: 'db/schema.prisma',
    migrations: {
      path: 'db/migrations',
      seed: 'yarn cedar exec seed',
    },
  })
`

const EXPECTED_NEW_CONFIG = dedent`
  const { defineConfig, env } = require('prisma/config')

  module.exports = defineConfig({
    schema: 'db/schema.prisma',
    migrations: {
      path: 'db/migrations',
      seed: 'yarn cedar exec seed',
    },
    datasource: {
      url: env('DATABASE_URL'),
    },
  })
`

describe('transformPrismaConfig', () => {
  it('adds env import and datasource block', () => {
    const result = transformPrismaConfig(OLD_CONFIG)

    expect(result).toContain(
      "const { defineConfig, env } = require('prisma/config')",
    )
    expect(result).toContain('datasource:')
    expect(result).toContain("url: env('DATABASE_URL')")
    expect(result).toBe(EXPECTED_NEW_CONFIG)
  })

  it('is idempotent if datasource block already present', () => {
    const result = transformPrismaConfig(EXPECTED_NEW_CONFIG)

    expect(result).toBe(EXPECTED_NEW_CONFIG)
  })

  it('adds env to existing destructure even with extra whitespace', () => {
    const configWithSpaces = dedent`
      const {  defineConfig  } = require('prisma/config')

      module.exports = defineConfig({
        schema: 'db/schema.prisma',
        migrations: {
          path: 'db/migrations',
          seed: 'yarn cedar exec seed',
        },
      })
    `

    const result = transformPrismaConfig(configWithSpaces)

    expect(result).toContain('env')
    expect(result).toContain('datasource:')
    expect(result).toContain("url: env('DATABASE_URL')")
  })

  it('does not add env twice if already present', () => {
    const configWithEnv = dedent`
      const { defineConfig, env } = require('prisma/config')

      module.exports = defineConfig({
        schema: 'db/schema.prisma',
        migrations: {
          path: 'db/migrations',
          seed: 'yarn cedar exec seed',
        },
      })
    `

    const result = transformPrismaConfig(configWithEnv)

    // env should appear exactly twice: once in the require line, once in the datasource block
    const envOccurrences = (result.match(/\benv\b/g) ?? []).length
    expect(envOccurrences).toBe(2)
    expect(result).toContain('datasource:')
  })
})

describe('updatePrismaConfig (fs-level)', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('skips file when it does not exist', async () => {
    const result = await updatePrismaConfig('/app/api/prisma.config.cjs')

    expect(result).toBe('skipped')
  })

  it('writes file when changes are needed', async () => {
    vol.fromJSON({
      '/app/api/prisma.config.cjs': OLD_CONFIG,
    })

    const result = await updatePrismaConfig('/app/api/prisma.config.cjs')

    expect(result).toBe('updated')

    const written = memfs.readFileSync(
      '/app/api/prisma.config.cjs',
      'utf-8',
    ) as string

    expect(written).toContain(
      "const { defineConfig, env } = require('prisma/config')",
    )
    expect(written).toContain('datasource:')
    expect(written).toContain("url: env('DATABASE_URL')")
  })

  it('returns unmodified when datasource block already present', async () => {
    vol.fromJSON({
      '/app/api/prisma.config.cjs': EXPECTED_NEW_CONFIG,
    })

    const result = await updatePrismaConfig('/app/api/prisma.config.cjs')

    expect(result).toBe('unmodified')

    // File should be unchanged
    const written = memfs.readFileSync(
      '/app/api/prisma.config.cjs',
      'utf-8',
    ) as string

    expect(written).toBe(EXPECTED_NEW_CONFIG)
  })
})
