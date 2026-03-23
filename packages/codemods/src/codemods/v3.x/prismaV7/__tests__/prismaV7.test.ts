import { fs as memfs, vol } from 'memfs'
import { dedent } from 'ts-dedent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// This is needed because of https://github.com/streamich/memfs/issues/1161
// Not using the pattern - just grabbing all files we've added to memfs
async function* memfsGlob(_pattern: string, options: { cwd: string }) {
  const entries = memfs.readdirSync(options.cwd, { recursive: true })

  for (const entry of entries) {
    // Hacky test if this is a file or directory
    if (/\.\w{2,3}$/.test(String(entry))) {
      yield entry
    }
  }
}

vi.mock('node:fs', () => {
  const mockedFs = {
    ...memfs,
    promises: {
      ...memfs.promises,
      glob: vi.fn().mockImplementation(memfsGlob),
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
        src: '/app/api/src',
        lib: '/app/api/src/lib',
        base: '/app/api',
        prismaConfig: '/app/api/prisma.config.cjs',
      },
      web: {
        base: '/app/web',
      },
      scripts: '/app/scripts',
      base: '/app',
    }),
    getSchemaPath: () => Promise.resolve('/app/api/db/schema.prisma'),
    getDataMigrationsPath: () => '/app/api/db/dataMigrations',
    ensurePosixPath: (path: string) => path.replace(/\\/g, '/'),
  }
})

import prismaV7 from '../prismaV7.js'

const OLD_SCHEMA = dedent`
  datasource db {
    provider = "sqlite"
    url      = env("DATABASE_URL")
  }

  generator client {
    provider      = "prisma-client-js"
    binaryTargets = "native"
  }
`

const OLD_PRISMA_CONFIG = dedent`
  const { defineConfig } = require('prisma/config')

  module.exports = defineConfig({
    schema: 'db/schema.prisma',
    migrations: {
      path: 'db/migrations',
      seed: 'yarn cedar exec seed',
    },
  })
`

const MINIMAL_TSCONFIG = dedent`
  {
    "compilerOptions": {
      "target": "es2023",
      "module": "node20",
      "moduleResolution": "node16",
      "skipLibCheck": false
    }
  }
`

const MINIMAL_PACKAGE_JSON =
  JSON.stringify(
    {
      name: 'api',
      version: '1.0.0',
      dependencies: {},
    },
    null,
    2,
  ) + '\n'

describe('prismaV7 (end-to-end integration)', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('end-to-end: transforms all files for a SQLite project', async () => {
    vol.fromJSON({
      '/app/api/db/schema.prisma': OLD_SCHEMA,
      '/app/api/prisma.config.cjs': OLD_PRISMA_CONFIG,
      '/app/.env.defaults': 'DATABASE_URL=file:./dev.db\n',
      '/app/.gitignore':
        dedent`
        node_modules
        .env
        dev.db*
        dist
      ` + '\n',
      '/app/api/package.json': MINIMAL_PACKAGE_JSON,
      '/app/api/tsconfig.json': MINIMAL_TSCONFIG,
    })

    await prismaV7()

    // --- schema.prisma ---
    const schema = memfs.readFileSync(
      '/app/api/db/schema.prisma',
      'utf-8',
    ) as string

    expect(schema).not.toContain('url      = env("DATABASE_URL")')
    expect(schema).not.toContain('prisma-client-js')
    expect(schema).toContain('provider               = "prisma-client"')
    expect(schema).toContain('output                 = "./generated/prisma"')
    expect(schema).toContain('moduleFormat           = "cjs"')
    expect(schema).toContain('generatedFileExtension = "mts"')
    expect(schema).toContain('importFileExtension    = "mts"')

    // --- prisma.config.cjs ---
    const prismaConfig = memfs.readFileSync(
      '/app/api/prisma.config.cjs',
      'utf-8',
    ) as string

    expect(prismaConfig).toContain(
      "const { defineConfig, env } = require('prisma/config')",
    )
    expect(prismaConfig).toContain('datasource:')
    expect(prismaConfig).toContain("url: env('DATABASE_URL')")

    // --- .env.defaults ---
    const envDefaults = memfs.readFileSync(
      '/app/.env.defaults',
      'utf-8',
    ) as string

    expect(envDefaults).toContain('DATABASE_URL=file:./db/dev.db')
    expect(envDefaults).not.toContain('DATABASE_URL=file:./dev.db')

    // --- .gitignore ---
    const gitignore = memfs.readFileSync('/app/.gitignore', 'utf-8') as string

    expect(gitignore).toContain('api/db/generated/prisma')

    const gitignoreLines = gitignore.split('\n')
    const devDbLineIndex = gitignoreLines.findIndex((l) => l === 'dev.db*')
    const generatedEntryIndex = gitignoreLines.findIndex(
      (l) => l === 'api/db/generated/prisma',
    )

    expect(generatedEntryIndex).toBe(devDbLineIndex + 1)

    // --- api/package.json ---
    const pkgJson = memfs.readFileSync(
      '/app/api/package.json',
      'utf-8',
    ) as string
    const pkg = JSON.parse(pkgJson) as {
      dependencies: Record<string, string>
    }

    expect(pkg.dependencies['@prisma/adapter-better-sqlite3']).toBeTruthy()
    expect(pkg.dependencies['better-sqlite3']).toBeTruthy()

    // --- api/tsconfig.json ---
    const tsconfig = memfs.readFileSync(
      '/app/api/tsconfig.json',
      'utf-8',
    ) as string

    expect(tsconfig).toContain('"allowImportingTsExtensions": true')

    const moduleResolutionIndex = tsconfig.indexOf('"moduleResolution"')
    const allowImportingIndex = tsconfig.indexOf('"allowImportingTsExtensions"')

    expect(allowImportingIndex).toBeGreaterThan(moduleResolutionIndex)
  })

  it('is safe to run on a project that has already been migrated', async () => {
    const alreadyMigratedSchema = dedent`
      datasource db {
        provider = "sqlite"
      }

      generator client {
        provider               = "prisma-client"
        output                 = "./generated/prisma"
        moduleFormat           = "cjs"
        generatedFileExtension = "mts"
        importFileExtension    = "mts"
      }
    `

    const alreadyMigratedConfig = dedent`
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

    const alreadyMigratedGitignore =
      dedent`
      node_modules
      .env
      dev.db*
      api/db/generated/prisma
      dist
    ` + '\n'

    const alreadyMigratedEnvDefaults = 'DATABASE_URL=file:./db/dev.db\n'

    const alreadyMigratedTsConfig = dedent`
      {
        "compilerOptions": {
          "target": "es2023",
          "module": "node20",
          "moduleResolution": "node16",
          "allowImportingTsExtensions": true,
          "skipLibCheck": false
        }
      }
    `

    const alreadyMigratedPackageJson =
      JSON.stringify(
        {
          name: 'api',
          version: '1.0.0',
          dependencies: {
            '@prisma/adapter-better-sqlite3': '^7.0.0',
            'better-sqlite3': '^12.0.0',
          },
        },
        null,
        2,
      ) + '\n'

    vol.fromJSON({
      '/app/api/db/schema.prisma': alreadyMigratedSchema,
      '/app/api/prisma.config.cjs': alreadyMigratedConfig,
      '/app/.env.defaults': alreadyMigratedEnvDefaults,
      '/app/.gitignore': alreadyMigratedGitignore,
      '/app/api/package.json': alreadyMigratedPackageJson,
      '/app/api/tsconfig.json': alreadyMigratedTsConfig,
    })

    // Should not throw and should not mutate any files
    await prismaV7()

    expect(memfs.readFileSync('/app/api/db/schema.prisma', 'utf-8')).toBe(
      alreadyMigratedSchema,
    )

    expect(memfs.readFileSync('/app/api/prisma.config.cjs', 'utf-8')).toBe(
      alreadyMigratedConfig,
    )

    expect(memfs.readFileSync('/app/.env.defaults', 'utf-8')).toBe(
      alreadyMigratedEnvDefaults,
    )

    expect(memfs.readFileSync('/app/.gitignore', 'utf-8')).toBe(
      alreadyMigratedGitignore,
    )

    expect(memfs.readFileSync('/app/api/package.json', 'utf-8')).toBe(
      alreadyMigratedPackageJson,
    )

    expect(memfs.readFileSync('/app/api/tsconfig.json', 'utf-8')).toBe(
      alreadyMigratedTsConfig,
    )
  })

  it('skips optional files that do not exist without throwing', async () => {
    // Only the schema and prisma config are present — everything else is absent
    vol.fromJSON({
      '/app/api/db/schema.prisma': OLD_SCHEMA,
      '/app/api/prisma.config.cjs': OLD_PRISMA_CONFIG,
    })

    await expect(prismaV7()).resolves.not.toThrow()

    // The files that were present should still have been updated
    const schema = memfs.readFileSync(
      '/app/api/db/schema.prisma',
      'utf-8',
    ) as string

    expect(schema).toContain('provider               = "prisma-client"')

    const prismaConfig = memfs.readFileSync(
      '/app/api/prisma.config.cjs',
      'utf-8',
    ) as string

    expect(prismaConfig).toContain('datasource:')
  })
})
