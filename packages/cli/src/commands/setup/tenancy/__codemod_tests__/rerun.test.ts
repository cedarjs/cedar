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

    // A file the app half-wired by hand: it has the import or export but
    // not the wiring, which the codemod still adds, once
    const runOn = async (codemod: string, source: string) => {
      const tempDir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
      )
      const tempFilePath = path.join(tempDir, 'file.ts')

      fs.writeFileSync(tempFilePath, source)

      try {
        const result = await runTransform({
          transformPath: path.join(__dirname, `../${codemod}.ts`),
          targetPaths: [tempFilePath],
        })

        expect(result.error).toBeUndefined()

        return fs.readFileSync(tempFilePath, 'utf-8')
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }

    const fixture = (name: string) =>
      fs.readFileSync(
        path.join(__dirname, '../__testfixtures__', name),
        'utf-8',
      )

    const count = (source: string, text: string) =>
      source.split(text).length - 1

    it('dbCodemod wires db when only the import is there', async () => {
      const output = await runOn(
        'dbCodemod',
        "import { createTenancyExtension } from '@cedarjs/tenancy'\n" +
          fixture('defaultDb.input.ts'),
      )

      expect(
        count(output, 'createTenancyExtension<typeof prismaClient>('),
      ).toBe(1)
      expect(count(output, 'import { createTenancyExtension }')).toBe(1)
    })

    it('graphqlCodemod wires the handler when only the import is there', async () => {
      const output = await runOn(
        'graphqlCodemod',
        "import { resolveCurrentOrg } from '@cedarjs/tenancy'\n" +
          fixture('defaultGraphql.input.ts'),
      )

      expect(count(output, 'resolveCurrentOrg({')).toBe(1)
      expect(count(output, 'resolveCurrentOrg }')).toBe(1)
      expect(output).toContain('isUserWithMemberships')
    })

    it('signupCodemod wires the handler when only the import is there', async () => {
      const output = await runOn(
        'signupCodemod',
        "import { ensureDefaultOrganization } from 'src/services/organizations/organizations'\n" +
          fixture('defaultSignupAuth.input.ts'),
      )

      expect(count(output, 'ensureDefaultOrganization(')).toBe(1)
      expect(count(output, 'import { ensureDefaultOrganization }')).toBe(1)
    })

    it('authCodemod re-exports only the names that are missing', async () => {
      const output = await runOn(
        'authCodemod',
        fixture('defaultAuth.output.ts').replace(
          "export { hasOrgRole, requireMembership } from '@cedarjs/tenancy'",
          "export { hasOrgRole } from '@cedarjs/tenancy'",
        ),
      )

      expect(output).toContain("export { hasOrgRole } from '@cedarjs/tenancy'")
      expect(output).toContain(
        "export { requireMembership } from '@cedarjs/tenancy'",
      )
    })
  },
)
