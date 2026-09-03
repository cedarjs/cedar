import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'
import { formatCode } from '../../../../testUtils/index.js'

// Skipping CI tests on Windows
// See the comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'tenancy dbCodemod',
  () => {
    it('wraps the default db.ts export in createTenancyExtension', async () => {
      await matchTransformSnapshot('dbCodemod', 'defaultDb')
    })

    it('chains onto an existing $extends call (e.g. uploads)', async () => {
      await matchTransformSnapshot('dbCodemod', 'uploadsDb')
    })

    it('throws RW_CODEMOD_ERR_OLD_FORMAT for the inline new PrismaClient() shape', async () => {
      const transformResult = await runTransform({
        transformPath: path.join(__dirname, '../dbCodemod.ts'), // Use TS here!
        targetPaths: [
          path.join(__dirname, '../__testfixtures__/oldFormat.input.ts'),
        ],
      })

      expect(transformResult.error).toContain('ERR_OLD_FORMAT')
    })

    it('emits a tenantField option when one is passed through options', async () => {
      const tempDir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
      )
      const tempFilePath = path.join(tempDir, 'db.ts')

      fs.copyFileSync(
        path.join(
          __dirname,
          '../__testfixtures__/customTenantFieldDb.input.ts',
        ),
        tempFilePath,
      )

      await runTransform({
        transformPath: path.join(__dirname, '../dbCodemod.ts'),
        targetPaths: [tempFilePath],
        options: {
          verbose: 1,
          print: true,
          tenantField: 'accountId',
        },
      })

      const transformedContent = fs.readFileSync(tempFilePath, 'utf-8')
      const expectedOutput = fs.readFileSync(
        path.join(
          __dirname,
          '../__testfixtures__/customTenantFieldDb.output.ts',
        ),
        'utf-8',
      )

      expect(await formatCode(transformedContent)).toEqual(
        await formatCode(expectedOutput),
      )

      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })
  },
)
