import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

describe('tenancy authCodemod', () => {
  it('adds a memberships select and replaces hasRole/requireAuth with createTenancyAuth', async () => {
    await matchTransformSnapshot('authCodemod', 'defaultAuth')
  })

  it('throws CEDAR_CODEMOD_ERR_AUTH_CHECKS_NOT_FOUND when hasRole/requireAuth are not there to replace', async () => {
    const transformResult = await runTransform({
      transformPath: path.join(__dirname, '../authCodemod.ts'), // Use TS here!
      targetPaths: [
        path.join(__dirname, '../__testfixtures__/noAuthChecks.input.ts'),
      ],
    })

    expect(transformResult.error).toContain('ERR_AUTH_CHECKS_NOT_FOUND')
  })

  it("throws CEDAR_CODEMOD_ERR_AUTH_CHECKS_CHANGED rather than dropping requireAuth's own checks", async () => {
    const transformResult = await runTransform({
      transformPath: path.join(__dirname, '../authCodemod.ts'), // Use TS here!
      targetPaths: [
        path.join(__dirname, '../__testfixtures__/customAuthChecks.input.ts'),
      ],
    })

    expect(transformResult.error).toContain('ERR_AUTH_CHECKS_CHANGED')
  })

  it('leaves an auth file that already uses createTenancyAuth as it is', async () => {
    await matchTransformSnapshot('authCodemod', 'wiredAuth')
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
