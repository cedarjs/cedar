import path from 'path'

import { getConfig } from '@cedarjs/project-config'

import { getApiSideBabelPlugins, transformWithBabel } from '../api'

const CEDAR_CWD = path.join(__dirname, '__fixtures__/redwood-app')
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
    beforeAll(async () => {
      const apiFile = path.join(CEDAR_CWD, 'api/src/lib/autoImports.ts')
      code = await prebuildApiFileWrapper(apiFile)
    })

    it('auto imports', () => {
      expect(code).toContain('import { context } from "@cedarjs/context"')
      expect(code).toContain('import gql from "graphql-tag"')
    })
  })
})

/**
 * We no longer prebuild files as part of the build process
 * This is so we can test the babel configuration in isolation
 */
export const prebuildApiFileWrapper = async (srcFile: string) => {
  const plugins = getApiSideBabelPlugins({
    openTelemetry: getConfig().experimental.opentelemetry.enabled,
  })

  const result = await transformWithBabel(srcFile, plugins)

  if (!result?.code) {
    throw new Error(`Couldn't prebuild ${srcFile}`)
  }

  return result.code
}
