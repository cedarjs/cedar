import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { vi, test, expect, afterAll } from 'vitest'

import { getPaths } from '../paths.js'
import { resolveGeneratedPrismaClient } from '../prisma.js'

vi.mock('@prisma/internals', () => {
  return {
    default: {
      createSchemaPathInput: ({
        schemaPathFromConfig,
      }: {
        baseDir: string
        schemaPathFromConfig: string
      }) => schemaPathFromConfig,
      getSchemaWithPath: ({ schemaPath }: { schemaPath: string }) => ({
        schemas: [[schemaPath, fs.readFileSync(schemaPath, 'utf-8')]],
        schemaRootDir: path.dirname(schemaPath),
      }),
      getConfig: ({ datamodel }: { datamodel: [string, string][] }) => {
        const content = datamodel[0]?.[1] ?? ''
        const outputMatch = content.match(/output\s*=\s*["']([^"']+)["']/)
        const extMatch = content.match(
          /generatedFileExtension\s*=\s*["']([^"']+)["']/,
        )
        return {
          generators: [
            {
              name: 'client',
              output: outputMatch ? { value: outputMatch[1] } : null,
              config: extMatch ? { generatedFileExtension: extMatch[1] } : {},
            },
          ],
        }
      },
    },
  }
})

vi.mock('../paths.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-paths-'))

  return {
    getPaths: () => ({
      base: tempDir,
      api: {
        prismaConfig: path.join(tempDir, 'api', 'db', 'prisma.config.ts'),
      },
    }),
  }
})

vi.mock('node:url', () => ({
  pathToFileURL: (inputPath: string | URL) => ({
    href: String(inputPath),
  }),
}))

afterAll(() => {
  fs.rmSync(getPaths().base, { recursive: true, force: true })
})

test('resolveGeneratedPrismaClient', async () => {
  const prismaConfigPath = getPaths().api.prismaConfig
  const schemaPath = path.join(getPaths().base, 'api', 'db', 'schema.prisma')

  fs.mkdirSync(path.dirname(prismaConfigPath), { recursive: true })
  fs.writeFileSync(
    prismaConfigPath,
    'export default { schema: "./schema.prisma" }',
  )
  fs.writeFileSync(
    schemaPath,
    `generator client {
      provider = "prisma-client"
      output = "./generated/prisma"
    }
    datasource db { provider = "sqlite" }`,
  )

  const expectedGeneratedPath = path.join(
    getPaths().base,
    'api',
    'db',
    'generated',
    'prisma',
    'client.ts',
  )

  // When the file doesn't exist, returns the computed path with an error message
  await expect(resolveGeneratedPrismaClient()).resolves.toEqual({
    clientPath: expectedGeneratedPath,
    error:
      `Could not find generated Prisma client entry. Checked: ${expectedGeneratedPath}. ` +
      'Run `yarn cedar prisma generate` and try again.',
  })

  // Create the generated file
  fs.mkdirSync(path.dirname(expectedGeneratedPath), { recursive: true })
  fs.writeFileSync(expectedGeneratedPath, 'export default { ModelName: {} }')

  // When the file exists, returns the path with no error
  await expect(resolveGeneratedPrismaClient()).resolves.toEqual({
    clientPath: expectedGeneratedPath,
    error: undefined,
  })
})
