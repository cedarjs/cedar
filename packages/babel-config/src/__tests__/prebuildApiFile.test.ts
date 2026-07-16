import fs from 'node:fs'
import path from 'path'

import { getApiSideBabelPlugins, transformWithBabel } from '../api.js'

const CEDAR_CWD = path.join(__dirname, '__fixtures__/cedar-app')
process.env.CEDAR_CWD = CEDAR_CWD

let code: string

describe('api prebuild ', () => {
  describe('typescript', () => {
    beforeAll(async () => {
      const apiFile = path.join(CEDAR_CWD, 'api/src/lib/typescript.ts')
      code = await prebuildApiFileWrapper(apiFile)
    })

    it('transpiles ts to js', () => {
      expect(code).toContain('const x = 0')
      expect(code).not.toContain('const x: number = 0')
    })
  })

  describe('auto imports', () => {
    // Auto-import has been removed from getApiSideBabelPlugins — Vite
    // handles it via cedarAutoImportsPlugin. The test fixture
    // autoImports.ts is unused and can be removed separately.
    it.todo('auto imports')
  })
})

/**
 * We no longer prebuild files as part of the build process
 * This is so we can test the babel configuration in isolation
 */
export const prebuildApiFileWrapper = async (srcFile: string) => {
  const plugins = getApiSideBabelPlugins({})

  const fileContents = fs.readFileSync(srcFile, 'utf-8')
  const result = await transformWithBabel(fileContents, srcFile, plugins)

  if (!result?.code) {
    throw new Error(`Couldn't prebuild ${srcFile}`)
  }

  return result.code
}
