import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { vi, test, expect, afterAll } from 'vitest'

import { getPaths } from '../paths.js'
import { resolveGeneratedPrismaClient } from '../prisma.js'

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

  // Without mustExist, returns the computed path even if the file doesn't exist yet
  await expect(resolveGeneratedPrismaClient()).resolves.toEqual(
    expectedGeneratedPath,
  )

  // With mustExist, throws when the file doesn't exist
  await expect(
    resolveGeneratedPrismaClient({ mustExist: true }),
  ).rejects.toThrow(
    `Could not find generated Prisma client entry. Checked: ${expectedGeneratedPath}. ` +
      'Run `yarn cedar prisma generate` and try again.',
  )

  // Create the generated file
  fs.mkdirSync(path.dirname(expectedGeneratedPath), { recursive: true })
  fs.writeFileSync(expectedGeneratedPath, 'export default { ModelName: {} }')

  // With mustExist, resolves when the file exists
  await expect(
    resolveGeneratedPrismaClient({ mustExist: true }),
  ).resolves.toEqual(expectedGeneratedPath)
})
