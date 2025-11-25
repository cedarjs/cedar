import execa from 'execa'
import { vol, fs as memfs } from 'memfs'
import { vi, expect, describe, it } from 'vitest'

import {
  getPaths,
  getDataMigrationsPath,
  getSchemaPath,
} from '@cedarjs/project-config'
import type ProjectConfig from '@cedarjs/project-config'

import {
  handler,
  RW_DATA_MIGRATION_MODEL,
  createDatabaseMigrationCommand,
  notes,
} from '../commands/installHandler'

vi.mock('fs', async () => ({ ...memfs, default: memfs }))
vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

vi.mock('execa', () => {
  const mockCommand = vi.fn(() => {
    return {
      stdout: 42,
    }
  })

  return {
    command: mockCommand,
    default: {
      command: mockCommand,
    },
  }
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()
  const mockPath = await import('path')

  return {
    ...originalProjectConfig,
    getSchemaPath: vi.fn(async (prismaConfigPath) => {
      // Simple mock: replace prisma.config.ts with schema.prisma
      return prismaConfigPath.replace('prisma.config.ts', 'schema.prisma')
    }),
    getDataMigrationsPath: vi.fn(async (prismaConfigPath) => {
      // Data migrations go next to the config file in test
      const configDir = mockPath.dirname(prismaConfigPath)
      return mockPath.join(configDir, 'dataMigrations')
    }),
  }
})

describe('installHandler', () => {
  it("the RW_DATA_MIGRATION_MODEL  hasn't unintentionally changed", () => {
    expect(RW_DATA_MIGRATION_MODEL).toMatchInlineSnapshot(`
      "model RW_DataMigration {
        version    String   @id
        name       String
        startedAt  DateTime
        finishedAt DateTime
      }"
    `)
  })

  it("the `createDatabaseMigrationCommand` hasn't unintentionally changed", () => {
    expect(createDatabaseMigrationCommand).toMatchInlineSnapshot(
      `"yarn rw prisma migrate dev --name create_data_migrations --create-only"`,
    )
  })

  it('adds a data migrations directory, model, and migration', async () => {
    const redwoodProjectPath = '/redwood-app'
    process.env.RWJS_CWD = redwoodProjectPath

    vol.fromNestedJSON(
      {
        'redwood.toml': '',
        api: {
          'prisma.config.ts': 'export default { schema: "./schema.prisma" }',
          'schema.prisma': '',
        },
      },
      redwoodProjectPath,
    )

    console.log = vi.fn()

    await handler()

    const prismaConfigPath = getPaths().api.prismaConfig
    const dataMigrationsPath = await getDataMigrationsPath(prismaConfigPath)
    const schemaPath = await getSchemaPath(prismaConfigPath)

    expect(memfs.readdirSync(dataMigrationsPath)).toEqual(['.keep'])
    expect(memfs.readFileSync(schemaPath, 'utf-8')).toMatch(
      RW_DATA_MIGRATION_MODEL,
    )
    expect(execa.command).toHaveBeenCalledWith(createDatabaseMigrationCommand, {
      cwd: getPaths().base,
    })
    expect(console.log).toHaveBeenCalledWith(notes)
  })
})
