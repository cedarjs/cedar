import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import runTransform from '../../../../lib/runTransform.js'
import { formatCode } from '../../../../testUtils/index.js'
import { matchTransformSnapshot } from '../../../../testUtils/matchTransformSnapshot.js'

const testPath = import.meta.dirname

async function runDbFileTransform(
  fixtureName: string,
  options: Record<string, unknown>,
): Promise<{ actual: string; expected: string }> {
  const tempDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
  )
  const tempFile = path.join(tempDir, 'db.ts')

  const fixturePath = path.join(
    testPath,
    `../__testfixtures__/updateDbFile.${fixtureName}.input.ts`,
  )
  const expectedPath = path.join(
    testPath,
    `../__testfixtures__/updateDbFile.${fixtureName}.output.ts`,
  )

  fs.copyFileSync(fixturePath, tempFile)

  await runTransform({
    transformPath: path.join(testPath, '../updateDbFile.ts'),
    targetPaths: [tempFile],
    parser: 'ts',
    options,
  })

  const actual = fs.readFileSync(tempFile, 'utf-8')
  const expected = fs.readFileSync(expectedPath, 'utf-8')

  fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})

  return { actual, expected }
}

describe('updateDbFile', () => {
  it('rewrites imports, adds adapter and resolveSqliteUrl for SQLite (default)', async () => {
    await matchTransformSnapshot('updateDbFile', 'updateDbFile', 'ts')
  })

  it('rewrites imports, adds PrismaPg adapter for PostgreSQL projects', async () => {
    const { actual, expected } = await runDbFileTransform('pg', {
      isSqlite: false,
      isPostgres: true,
    })

    expect(await formatCode(actual)).toEqual(await formatCode(expected))
  })

  it('injects PrismaPg adapter into a PostgreSQL file already partially migrated by an older codemod run', async () => {
    const { actual, expected } = await runDbFileTransform('pg-partial', {
      isSqlite: false,
      isPostgres: true,
    })

    expect(await formatCode(actual)).toEqual(await formatCode(expected))
  })

  it('only rewrites import paths for unknown providers', async () => {
    const { actual, expected } = await runDbFileTransform('unknown', {
      isSqlite: false,
      isPostgres: false,
    })

    expect(await formatCode(actual)).toEqual(await formatCode(expected))
  })
})
