import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isPrismaClientGenerated } from '../generatePrismaClient.js'

const require = createRequire(import.meta.url)

describe('generatePrismaClient detection', () => {
  let tmpDir: string
  let clientFile: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-prisma-detection-'))

    // Copy the fixture schema into a nested api/db structure so that
    // the generated output lands under api/db/generated/
    const schemaDir = path.join(tmpDir, 'api', 'db')
    fs.mkdirSync(schemaDir, { recursive: true })
    fs.copyFileSync(
      path.join(import.meta.dirname, 'fixtures', 'schema.prisma'),
      path.join(schemaDir, 'schema.prisma'),
    )

    // Run prisma generate using the same resolution as the production code
    const prismaIndexPath = require.resolve('prisma/build/index.js')
    execSync(
      `node ${prismaIndexPath} generate --schema=${schemaDir}/schema.prisma`,
      {
        cwd: tmpDir,
        stdio: 'pipe',
      },
    )

    // The output path is relative to the schema dir
    clientFile = path.join(schemaDir, 'generated', 'client.mts')
  })

  afterAll(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('generates the client file at the expected path', () => {
    expect(fs.existsSync(clientFile)).toBe(true)
  })

  it('generates client with ESM export syntax', () => {
    const content = fs.readFileSync(clientFile, 'utf-8')

    expect(content).toContain('export const PrismaClient')
  })

  it('does not contain the stub placeholder', () => {
    const content = fs.readFileSync(clientFile, 'utf-8')

    expect(content).not.toContain('@prisma/client did not initialize yet.')
  })

  it('can be detected by isPrismaClientGenerated', () => {
    const content = fs.readFileSync(clientFile, 'utf-8')

    // If this fails, Prisma changed the generated output format and
    // isPrismaClientGenerated in generatePrismaClient.ts needs updating
    expect(isPrismaClientGenerated(content)).toBe(true)
  })
})
