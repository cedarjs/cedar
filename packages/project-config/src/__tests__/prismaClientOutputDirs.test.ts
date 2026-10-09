import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { vi, test, expect, afterAll } from 'vitest'

import { getPaths } from '../paths.js'
import {
  createPrismaClientFileMatcher,
  getPrismaClientOutputDirs,
} from '../prisma.js'

vi.mock('../paths.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-paths-'))

  return {
    getPaths: () => ({
      base: tempDir,
      api: {
        prismaConfig: path.join(tempDir, 'api', 'db', 'prisma.config.mjs'),
      },
    }),
  }
})

afterAll(() => {
  fs.rmSync(getPaths().base, { recursive: true, force: true })
})

test('getPrismaClientOutputDirs', async () => {
  const prismaConfigPath = getPaths().api.prismaConfig
  const dbDir = path.dirname(prismaConfigPath)

  fs.mkdirSync(dbDir, { recursive: true })
  fs.writeFileSync(
    prismaConfigPath,
    'export default { schema: "./schema.prisma" }',
  )
  fs.writeFileSync(
    path.join(dbDir, 'schema.prisma'),
    `generator client {
      provider = "prisma-client"
      output   = "../src/generated/prisma"
    }

    generator legacyClient {
      provider = "prisma-client-js"
      output   = "./generated/legacy"
    }

    generator zod {
      provider = "zod-prisma-types"
      output   = "../src/generated/zod"
    }

    datasource db {
      provider = "sqlite"
    }`,
  )

  await expect(getPrismaClientOutputDirs()).resolves.toEqual([
    path.join(getPaths().base, 'api', 'src', 'generated', 'prisma'),
    path.join(dbDir, 'generated', 'legacy'),
  ])
})

test('getPrismaClientOutputDirs returns an empty array without a schema', async () => {
  fs.rmSync(
    path.join(path.dirname(getPaths().api.prismaConfig), 'schema.prisma'),
  )

  await expect(getPrismaClientOutputDirs()).resolves.toEqual([])
})

test('createPrismaClientFileMatcher', async () => {
  const outputDir = path.join(getPaths().base, 'api', 'src', 'generated')
  const resolveOutputDirs = vi.fn(async () => [outputDir])
  const prismaClientFiles = createPrismaClientFileMatcher(resolveOutputDirs)

  await prismaClientFiles.load()

  await expect(
    prismaClientFiles.matches(path.join(outputDir, 'prisma', 'client.ts')),
  ).resolves.toBe(true)
  await expect(prismaClientFiles.matches(outputDir)).resolves.toBe(false)
  await expect(
    prismaClientFiles.matches(outputDir + '-extra/client.ts'),
  ).resolves.toBe(false)
  await expect(
    prismaClientFiles.matches(
      path.join(getPaths().base, 'api', 'src', 'lib', 'db.ts'),
    ),
  ).resolves.toBe(false)

  // Vite module ids always use forward slashes
  await expect(
    prismaClientFiles.matches(
      outputDir.split(path.sep).join('/') + '/prisma/models/User.ts',
    ),
  ).resolves.toBe(true)

  expect(resolveOutputDirs).toHaveBeenCalledOnce()
})
