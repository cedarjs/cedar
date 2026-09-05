import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

// Skipping CI tests on Windows
// See the comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'tenancy graphqlCodemod',
  () => {
    it('adds imports and a context option to createGraphQLHandler', async () => {
      await matchTransformSnapshot('graphqlCodemod', 'defaultGraphql')
    })

    it('throws CEDAR_CODEMOD_ERR_GRAPHQL_HANDLER_NOT_FOUND when createGraphQLHandler is missing', async () => {
      const tempDir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
      )
      const tempFilePath = path.join(tempDir, 'graphql.ts')

      fs.writeFileSync(
        tempFilePath,
        `export const handler = () => ({ statusCode: 200 })\n`,
      )

      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../graphqlCodemod.ts'), // Use TS here!
        targetPaths: [tempFilePath],
      })

      expect(transformResult.error).toContain('ERR_GRAPHQL_HANDLER_NOT_FOUND')

      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('throws CEDAR_CODEMOD_ERR_GRAPHQL_CONTEXT_EXISTS when a context option is already present', async () => {
      const tempDir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
      )
      const tempFilePath = path.join(tempDir, 'graphql.ts')

      fs.writeFileSync(
        tempFilePath,
        `
        import { createGraphQLHandler } from '@cedarjs/graphql-server'

        export const handler = createGraphQLHandler({
          context: () => ({}),
        })
        `,
      )

      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../graphqlCodemod.ts'),
        targetPaths: [tempFilePath],
      })

      expect(transformResult.error).toContain('ERR_GRAPHQL_CONTEXT_EXISTS')

      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })
  },
)
