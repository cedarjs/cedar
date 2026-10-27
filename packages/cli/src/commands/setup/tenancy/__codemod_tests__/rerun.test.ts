import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'

describe('running the tenancy codemods again', () => {
  it.each([
    ['authCodemod', 'defaultAuth.output.ts'],
    ['dbCodemod', 'defaultDb.output.ts'],
    ['graphqlCodemod', 'defaultGraphql.output.ts'],
    ['signupCodemod', 'defaultSignupAuth.output.ts'],
    ['routerCodemod', 'defaultRoutes.output.tsx'],
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
    fs.readFileSync(path.join(__dirname, '../__testfixtures__', name), 'utf-8')

  const count = (source: string, text: string) => source.split(text).length - 1

  it.each([
    ['authCodemod', 'defaultAuth.output.ts'],
    ['dbCodemod', 'defaultDb.output.ts'],
    ['graphqlCodemod', 'defaultGraphql.output.ts'],
    ['signupCodemod', 'defaultSignupAuth.output.ts'],
    ['routerCodemod', 'defaultRoutes.output.tsx'],
  ])(
    '%s leaves an already wired file with CRLF line endings as it is',
    async (codemod, name) => {
      // How git checks the fixtures out on Windows
      const wired = fixture(name).replace(/\r?\n/g, '\r\n')

      expect(await runOn(codemod, wired)).toBe(wired)
    },
  )

  it('dbCodemod wires db when only the import is there', async () => {
    const output = await runOn(
      'dbCodemod',
      "import { createTenancyExtension } from '@cedarjs/tenancy'\n" +
        fixture('defaultDb.input.ts'),
    )

    expect(count(output, 'createTenancyExtension<typeof prismaClient>(')).toBe(
      1,
    )
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

  it('routerCodemod adds the prop when only the import is there', async () => {
    const output = await runOn(
      'routerCodemod',
      "import { useOrgRoles } from '@cedarjs/tenancy/web'\n" +
        fixture('defaultRoutes.input.tsx'),
    )

    expect(count(output, 'useOrgRoles={useOrgRoles}')).toBe(1)
    expect(count(output, 'import { useOrgRoles }')).toBe(1)
  })

  it('routerCodemod adds the import when only the prop is there', async () => {
    const output = await runOn(
      'routerCodemod',
      fixture('defaultRoutes.input.tsx').replace(
        '<Router useAuth={useAuth}>',
        '<Router useAuth={useAuth} useOrgRoles={useOrgRoles}>',
      ),
    )

    expect(count(output, 'useOrgRoles={useOrgRoles}')).toBe(1)
    expect(count(output, 'import { useOrgRoles }')).toBe(1)
  })

  it('authCodemod wraps a lookup that is not awaited only once', async () => {
    const notAwaited = fixture('defaultAuth.input.ts').replace(
      'return await db.user.findUnique(',
      'return db.user.findUnique(',
    )

    const once = await runOn('authCodemod', notAwaited)
    const twice = await runOn('authCodemod', once)

    expect(count(once, '.then(withPermissions)')).toBe(1)
    expect(twice).toBe(once)
  })

  it("authCodemod doesn't wrap a user lookup without memberships", async () => {
    const output = await runOn(
      'authCodemod',
      fixture('defaultAuth.input.ts') +
        '\nexport const findUser = (id: number) =>\n' +
        '  db.user.findUnique({ where: { id } })\n',
    )

    expect(count(output, 'withPermissions(')).toBe(1)
    expect(output).not.toContain('.then(withPermissions)')
  })
})
