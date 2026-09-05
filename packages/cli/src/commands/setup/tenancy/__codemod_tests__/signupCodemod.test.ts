import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

// Skipping CI tests on Windows
// See the comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'tenancy signupCodemod',
  () => {
    it('wraps the dbAuth signup handler with ensureDefaultOrganization', async () => {
      await matchTransformSnapshot('signupCodemod', 'defaultSignupAuth')
    })

    it('throws CEDAR_CODEMOD_ERR_SIGNUP_SHAPE_NOT_FOUND when there is no signupOptions', async () => {
      const tempDir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
      )
      const tempFilePath = path.join(tempDir, 'auth.ts')

      fs.writeFileSync(
        tempFilePath,
        `export const handler = async () => ({ statusCode: 200 })\n`,
      )

      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../signupCodemod.ts'), // Use TS here!
        targetPaths: [tempFilePath],
      })

      expect(transformResult.error).toContain('ERR_SIGNUP_SHAPE_NOT_FOUND')

      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })
  },
)
