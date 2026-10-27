import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

describe('tenancy routerCodemod', () => {
  it('passes tenancy to the Router', async () => {
    await matchTransformSnapshot('routerCodemod', 'defaultRoutes')
  })

  it('leaves other @cedarjs/tenancy/web imports alone', async () => {
    await matchTransformSnapshot('routerCodemod', 'tenancyImportRoutes')
  })

  it('replaces useOrgRoles with tenancy, removing its import', async () => {
    await matchTransformSnapshot('routerCodemod', 'canaryRoutes')
  })

  it('keeps other @cedarjs/tenancy/web imports when removing useOrgRoles', async () => {
    await matchTransformSnapshot('routerCodemod', 'canaryImportRoutes')
  })

  it('throws CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND without a <Router>', async () => {
    const transformResult = await runTransform({
      transformPath: path.join(__dirname, '../routerCodemod.ts'), // Use TS here!
      targetPaths: [
        path.join(
          __dirname,
          '../__testfixtures__/unrecognizedRoutes.input.tsx',
        ),
      ],
    })

    expect(transformResult.error).toContain('ERR_ROUTER_NOT_FOUND')
  })

  it('throws CEDAR_CODEMOD_ERR_ROUTER_NOT_FOUND with more than one Router', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
    )
    const tempFilePath = path.join(tempDir, 'Routes.tsx')
    const source = `
      import { Router, Route } from '@cedarjs/router'

      import { useAuth } from './auth'

      const Routes = ({ admin }) =>
        admin ? (
          <Router useAuth={useAuth}>
            <Route notfound page={NotFoundPage} />
          </Router>
        ) : (
          <Router>
            <Route notfound page={NotFoundPage} />
          </Router>
        )

      export default Routes
    `

    fs.writeFileSync(tempFilePath, source)

    try {
      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../routerCodemod.ts'),
        targetPaths: [tempFilePath],
      })

      expect(transformResult.error).toContain('ERR_ROUTER_NOT_FOUND')
      expect(fs.readFileSync(tempFilePath, 'utf-8')).toBe(source)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
