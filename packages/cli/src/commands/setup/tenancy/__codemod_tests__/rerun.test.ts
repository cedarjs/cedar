import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

// Skipping CI tests on Windows
// See the comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'running the tenancy codemods again',
  () => {
    it.each([
      ['authCodemod', 'defaultAuth.output.ts'],
      ['dbCodemod', 'defaultDb.output.ts'],
      ['graphqlCodemod', 'defaultGraphql.output.ts'],
      ['signupCodemod', 'defaultSignupAuth.output.ts'],
    ])('%s leaves an already wired file as it is', async (codemod, fixture) => {
      const tempDir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
      )
      const tempFilePath = path.join(tempDir, 'file.ts')
      const wired = fs.readFileSync(
        path.join(__dirname, '../__testfixtures__', fixture),
        'utf-8',
      )

      fs.writeFileSync(tempFilePath, wired)

      try {
        const result = await runTransform({
          transformPath: path.join(__dirname, `../${codemod}.ts`),
          targetPaths: [tempFilePath],
        })

        expect(result.error).toBeUndefined()
        expect(fs.readFileSync(tempFilePath, 'utf-8')).toBe(wired)
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })
  },
)
