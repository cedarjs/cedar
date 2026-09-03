import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

// Skipping CI tests on Windows
// See the comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'tenancy authCodemod',
  () => {
    it('adds a memberships select and re-exports hasOrgRole/requireMembership', async () => {
      await matchTransformSnapshot('authCodemod', 'defaultAuth')
    })

    it('throws RW_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND when getCurrentUser has no recognizable select', async () => {
      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../authCodemod.ts'), // Use TS here!
        targetPaths: [
          path.join(__dirname, '../__testfixtures__/unrecognizedAuth.input.ts'),
        ],
      })

      expect(transformResult.error).toContain('ERR_AUTH_SHAPE_NOT_FOUND')
    })
  },
)
