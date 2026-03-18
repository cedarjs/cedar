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

import { updateSchemaFile } from '../updateSchemaFile.js'

const OLD_SQLITE_SCHEMA = dedent`
  datasource db {
    provider = "sqlite"
    url      = env("DATABASE_URL")
  }

  generator client {
    provider      = "prisma-client-js"
    binaryTargets = "native"
  }
`

const OLD_PG_SCHEMA = dedent`
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }

  generator client {
    provider      = "prisma-client-js"
    binaryTargets = "native"
  }
`

const NEW_GENERATOR_BLOCK = dedent`
  generator client {
    provider               = "prisma-client"
    output                 = "./generated/prisma"
    moduleFormat           = "cjs"
    generatedFileExtension = "mts"
    importFileExtension    = "mts"
  }
`

describe('updateSchemaFile', () => {
  beforeEach(() => {
    vol.reset()
    vi.clearAllMocks()
  })

  it('removes url line and updates generator block (SQLite)', async () => {
    vol.fromJSON({
      '/app/api/db/schema.prisma': OLD_SQLITE_SCHEMA,
    })

    const result = await updateSchemaFile('/app/api/db/schema.prisma')

    expect(result.status).toBe('updated')
    expect(result.warnings).toEqual([])

    const written = memfs.readFileSync('/app/api/db/schema.prisma', 'utf-8')

    expect(written).not.toContain('url      = env("DATABASE_URL")')
    expect(written).toContain('provider               = "prisma-client"')
    expect(written).toContain('output                 = "./generated/prisma"')
    expect(written).toContain('moduleFormat           = "cjs"')
    expect(written).toContain('generatedFileExtension = "mts"')
    expect(written).toContain('importFileExtension    = "mts"')
    expect(written).not.toContain('prisma-client-js')
  })

  it('removes url line and updates generator block (PostgreSQL)', async () => {
    vol.fromJSON({
      '/app/api/db/schema.prisma': OLD_PG_SCHEMA,
    })

    const result = await updateSchemaFile('/app/api/db/schema.prisma')

    expect(result.status).toBe('updated')
    expect(result.warnings).toEqual([])

    const written = memfs.readFileSync('/app/api/db/schema.prisma', 'utf-8')

    expect(written).not.toContain('url      = env("DATABASE_URL")')
    expect(written).toContain('provider               = "prisma-client"')
    expect(written).not.toContain('prisma-client-js')
  })

  it('removes directUrl line and adds a warning', async () => {
    const schemaWithDirectUrl = dedent`
      datasource db {
        provider  = "postgresql"
        url       = env("DATABASE_URL")
        directUrl = env("DIRECT_DATABASE_URL")
      }

      generator client {
        provider = "prisma-client-js"
      }
    `

    vol.fromJSON({
      '/app/api/db/schema.prisma': schemaWithDirectUrl,
    })

    const result = await updateSchemaFile('/app/api/db/schema.prisma')

    expect(result.status).toBe('updated')
    expect(result.warnings).toHaveLength(1)
    // In Prisma v7, directUrl is gone. The direct URL value goes into `url:`
    // (the CLI uses `url` for migrations etc)
    expect(result.warnings[0]).toContain("url: env('DIRECT_DATABASE_URL')")

    const written = memfs.readFileSync('/app/api/db/schema.prisma', 'utf-8')

    expect(written).not.toContain('directUrl')
    expect(written).not.toContain('url       = env("DATABASE_URL")')
  })

  it('warns about custom binaryTargets', async () => {
    const schemaWithBinaryTargets = dedent`
      datasource db {
        provider = "sqlite"
        url      = env("DATABASE_URL")
      }

      generator client {
        provider      = "prisma-client-js"
        binaryTargets = ["native", "linux-musl"]
      }
    `

    vol.fromJSON({
      '/app/api/db/schema.prisma': schemaWithBinaryTargets,
    })

    const result = await updateSchemaFile('/app/api/db/schema.prisma')

    expect(result.status).toBe('updated')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('binaryTargets')
    expect(result.warnings[0]).toContain('linux-musl')
  })

  it('is idempotent when already migrated', async () => {
    const alreadyMigratedSchema = dedent`
      datasource db {
        provider = "sqlite"
      }

      ${NEW_GENERATOR_BLOCK}
    `

    vol.fromJSON({
      '/app/api/db/schema.prisma': alreadyMigratedSchema,
    })

    const result = await updateSchemaFile('/app/api/db/schema.prisma')

    expect(result.status).toBe('unmodified')
    expect(result.warnings).toEqual([])
  })

  it('skips when file does not exist', async () => {
    const result = await updateSchemaFile('/app/api/db/schema.prisma')

    expect(result.status).toBe('skipped')
    expect(result.warnings).toEqual([])
  })
})
