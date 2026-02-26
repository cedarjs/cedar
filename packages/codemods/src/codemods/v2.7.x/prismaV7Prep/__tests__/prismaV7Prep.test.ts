import fs from 'node:fs'
import path from 'node:path'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { createProjectMock } from '../../../../testUtils/index'
import { matchFolderTransform } from '../../../../testUtils/matchFolderTransform'
import prismaV7Prep from '../prismaV7Prep'

describe('prismaV7Prep', () => {
  it('adds db re-export and rewrites prisma imports in api/src, dataMigrations, and scripts', async () => {
    await matchFolderTransform(prismaV7Prep, 'ts-core')
  })

  it('does not duplicate existing db re-export and still rewrites JS imports', async () => {
    await matchFolderTransform(prismaV7Prep, 'js-existing-export')
  })

  it('rewrites imports for cjs/esm and cts/mts files', async () => {
    await matchFolderTransform(prismaV7Prep, 'module-ext-matrix')
  })

  it('is idempotent when run multiple times', async () => {
    const tempDir = createProjectMock()
    const testPath = expect.getState().testPath
    if (!testPath) {
      throw new Error('Could not find test path')
    }
    const fixtureInputDir = path.join(
      testPath,
      '../../__testfixtures__/ts-core/input',
    )

    const previousCwd = process.env.CEDAR_CWD
    process.env.CEDAR_CWD = tempDir
    fs.cpSync(fixtureInputDir, tempDir, { recursive: true })

    const snapshotFiles = () => {
      const files = fg.sync('**/*', {
        cwd: tempDir,
        dot: true,
        ignore: ['cedar.toml', '**/*.DS_Store'],
      })

      return files.reduce<Record<string, string>>((acc, relativePath) => {
        const fullPath = path.join(tempDir, relativePath)

        if (fs.statSync(fullPath).isFile()) {
          acc[relativePath] = fs.readFileSync(fullPath, 'utf-8')
        }

        return acc
      }, {})
    }

    try {
      await prismaV7Prep()
      const afterFirstRun = snapshotFiles()

      await prismaV7Prep()
      const afterSecondRun = snapshotFiles()

      expect(afterSecondRun).toEqual(afterFirstRun)
    } finally {
      if (previousCwd) {
        process.env.CEDAR_CWD = previousCwd
      } else {
        delete process.env.CEDAR_CWD
      }

      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
