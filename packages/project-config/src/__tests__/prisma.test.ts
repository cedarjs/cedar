import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { vi, test, expect } from 'vitest'

import { getPaths } from '../paths.js'
import { resolveGeneratedPrismaClient } from '../prisma.js'

vi.mock('../paths.js', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-paths-'))

  return {
    getPaths: () => ({
      base: tempDir,
    }),
  }
})

test('resolveGeneratedPrismaClient', () => {
  const expectedPath = path.join(
    getPaths().base,
    'node_modules/.prisma/client/index.js',
  )

  expect(resolveGeneratedPrismaClient()).toEqual(expectedPath)

  expect(() => resolveGeneratedPrismaClient({ mustExist: true })).toThrow(
    `Could not find generated Prisma client entry at ${expectedPath}. ` +
      'Run `yarn cedar prisma generate` and try again.',
  )

  fs.mkdirSync(path.dirname(expectedPath), { recursive: true })
  fs.writeFileSync(expectedPath, 'module.exports = {}')

  expect(resolveGeneratedPrismaClient({ mustExist: true })).toEqual(
    expectedPath,
  )

  fs.rmSync(getPaths().base, { recursive: true, force: true })
})
