import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

describe('tenancy authCodemod', () => {
  it('adds a memberships select and withPermissions', async () => {
    await matchTransformSnapshot('authCodemod', 'defaultAuth')
  })

  it("leaves the app's own hasRole and requireAuth as they are", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
    )
    const tempFilePath = path.join(tempDir, 'auth.ts')

    fs.copyFileSync(
      path.join(__dirname, '../__testfixtures__/customAuthChecks.input.ts'),
      tempFilePath,
    )

    try {
      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../authCodemod.ts'), // Use TS here!
        targetPaths: [tempFilePath],
      })

      expect(transformResult.error).toBeUndefined()

      const output = fs.readFileSync(tempFilePath, 'utf-8')

      expect(output).toContain('withPermissions(')
      expect(output).toContain('export const hasRole = ')
      expect(output).toContain(
        "throw new ForbiddenError('Your account is suspended.')",
      )
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('throws CEDAR_CODEMOD_ERR_AUTH_SHAPE_NOT_FOUND when getCurrentUser has no recognizable select', async () => {
    const transformResult = await runTransform({
      transformPath: path.join(__dirname, '../authCodemod.ts'), // Use TS here!
      targetPaths: [
        path.join(__dirname, '../__testfixtures__/unrecognizedAuth.input.ts'),
      ],
    })

    expect(transformResult.error).toContain('ERR_AUTH_SHAPE_NOT_FOUND')
  })
})
