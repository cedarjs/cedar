import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import runTransform from '../../../../lib/runTransform.js'
import { formatCode } from '../../../../testUtils/index.js'
import { matchTransformSnapshot } from '../../../../testUtils/matchTransformSnapshot.js'

describe('updateDbFile', () => {
  it('rewrites imports, adds adapter and resolveSqliteUrl for SQLite (default)', async () => {
    await matchTransformSnapshot('updateDbFile', 'updateDbFile', 'ts')
  })

  it('rewrites imports, adds PrismaPg adapter for PostgreSQL projects', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
    )
    const tempFile = path.join(tempDir, 'db.ts')

    const testPath = import.meta.dirname

    const fixturePath = path.join(
      testPath,
      '../__testfixtures__/updateDbFile.pg.input.ts',
    )
    const expectedPath = path.join(
      testPath,
      '../__testfixtures__/updateDbFile.pg.output.ts',
    )

    fs.copyFileSync(fixturePath, tempFile)

    await runTransform({
      transformPath: path.join(testPath, '../updateDbFile.ts'),
      targetPaths: [tempFile],
      parser: 'ts',
      options: {
        isSqlite: false,
        isPostgres: true,
        silent: true,
      } as Record<string, unknown>,
    })

    const actual = fs.readFileSync(tempFile, 'utf-8')
    const expected = fs.readFileSync(expectedPath, 'utf-8')

    expect(await formatCode(actual)).toEqual(await formatCode(expected))

    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('only rewrites import paths for unknown providers', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
    )
    const tempFile = path.join(tempDir, 'db.ts')

    const testPath = import.meta.dirname

    const fixturePath = path.join(
      testPath,
      '../__testfixtures__/updateDbFile.unknown.input.ts',
    )
    const expectedPath = path.join(
      testPath,
      '../__testfixtures__/updateDbFile.unknown.output.ts',
    )

    fs.copyFileSync(fixturePath, tempFile)

    await runTransform({
      transformPath: path.join(testPath, '../updateDbFile.ts'),
      targetPaths: [tempFile],
      parser: 'ts',
      options: {
        isSqlite: false,
        isPostgres: false,
        silent: true,
      } as Record<string, unknown>,
    })

    const actual = fs.readFileSync(tempFile, 'utf-8')
    const expected = fs.readFileSync(expectedPath, 'utf-8')

    expect(await formatCode(actual)).toEqual(await formatCode(expected))

    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })
})
