import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

// Skipping CI tests on Windows
// See my comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'Db codemod',
  () => {
    it('Handles the default db case', async () => {
      await matchTransformSnapshot('dbCodemod', 'defaultDb')
    })

    it('will throw an error if the db file has the old format', async () => {
      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../dbCodemod.ts'), // Use TS here!
        targetPaths: [
          path.join(__dirname, '../__testfixtures__/oldFormat.input.ts'),
        ],
      })

      expect(transformResult.error).toContain('ERR_OLD_FORMAT')
    })
  },
)
