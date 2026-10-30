import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runTransform } from '../../../../lib/runTransform.js'
import { formatCode } from '../../../../testUtils/index.js'

const runOn = async (source: string, options: Record<string, unknown> = {}) => {
  const tempDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
  )
  const tempFilePath = path.join(tempDir, 'auth.ts')

  fs.writeFileSync(tempFilePath, source)

  try {
    const result = await runTransform({
      transformPath: path.join(__dirname, '../authCodemod.ts'),
      targetPaths: [tempFilePath],
      options,
    })

    return {
      error: result.error,
      output: fs.readFileSync(tempFilePath, 'utf-8'),
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../__testfixtures__', name), 'utf-8')

describe('permissions authCodemod', () => {
  it("wraps dbAuth's user lookup in withPermissions", async () => {
    await matchTransformSnapshot('authCodemod', 'defaultAuth')
  })

  it('wraps every user getCurrentUser returns, and leaves null', async () => {
    await matchTransformSnapshot('authCodemod', 'tokenAuth')
  })

  it.each([['defaultAuth.output.ts'], ['tokenAuth.output.ts']])(
    'leaves %s, already wired, as it is',
    async (name) => {
      const wired = fixture(name)
      const { error, output } = await runOn(wired)

      expect(error).toBeUndefined()
      expect(output).toBe(wired)
    },
  )

  it('awaits a returned variable that may hold a lookup', async () => {
    const { error, output } = await runOn(
      [
        "import { db } from './db.js'",
        '',
        'export const getCurrentUser = async (session) => {',
        '  const user = db.user.findUnique({ where: { id: session.id } })',
        '  return user',
        '}',
        '',
      ].join('\n'),
    )

    expect(error).toBeUndefined()
    expect(output).toContain('return withPermissions(await user)')
    expect((await runOn(output)).output).toBe(output)
  })

  it('resolves what a function that is not async returns', async () => {
    const { error, output } = await runOn(
      [
        "import { db } from './db.js'",
        '',
        'export const getCurrentUser = (session) => {',
        '  return toUser(session)',
        '}',
        '',
      ].join('\n'),
    )

    expect(error).toBeUndefined()
    expect(output).toContain(
      'return Promise.resolve(toUser(session)).then(withPermissions)',
    )
    expect((await runOn(output)).output).toBe(output)
  })

  it('selects roles when the User model has them', async () => {
    const { error, output } = await runOn(fixture('defaultAuth.input.ts'), {
      userHasRoles: true,
    })

    expect(error).toBeUndefined()
    expect(await formatCode(output)).toBe(
      await formatCode(fixture('selectRoles.output.ts')),
    )

    // Once
    const again = await runOn(output, { userHasRoles: true })

    expect(again.output).toBe(output)
  })

  it('adds roles to a select that is already wrapped', async () => {
    const { output } = await runOn(fixture('defaultAuth.output.ts'), {
      userHasRoles: true,
    })

    expect(await formatCode(output)).toBe(
      await formatCode(fixture('selectRoles.output.ts')),
    )
  })

  it('keeps a select with roles as the app wrote it', async () => {
    const wired = fixture('selectRoles.output.ts')
    const { output } = await runOn(wired, { userHasRoles: true })

    expect(output).toBe(wired)
  })

  it("leaves tenancy's wiring as it is", async () => {
    const wired = fixture(
      '../../tenancy/__testfixtures__/defaultAuth.output.ts',
    )
    const { error, output } = await runOn(wired)

    expect(error).toBeUndefined()
    expect(output).toBe(wired)
  })

  it('awaits a lookup that is returned without await', async () => {
    const { output } = await runOn(
      [
        "import { db } from 'src/lib/db'",
        '',
        'export const getCurrentUser = async (session) => {',
        '  return db.user.findUnique({ where: { id: session.id } })',
        '}',
        '',
      ].join('\n'),
    )

    expect(output).toContain(
      'return withPermissions(await db.user.findUnique({ where: { id: session.id } }))',
    )
    expect(output).toContain(
      "import { withPermissions } from 'src/lib/permissions'",
    )
  })

  it('uses then() in a function that is not async', async () => {
    const { output } = await runOn(
      [
        'export function getCurrentUser(session) {',
        '  return db.user.findUnique({ where: { id: session.id } })',
        '}',
        '',
      ].join('\n'),
    )

    expect(output).toContain(
      'return db.user.findUnique({ where: { id: session.id } }).then(withPermissions)',
    )
  })

  it('throws CEDAR_CODEMOD_ERR_GET_CURRENT_USER_NOT_FOUND without a user to wrap', async () => {
    const { error } = await runOn(fixture('noUser.input.ts'))

    expect(error).toContain('ERR_GET_CURRENT_USER_NOT_FOUND')

    const none = await runOn('export const isAuthenticated = () => true\n')

    expect(none.error).toContain('ERR_GET_CURRENT_USER_NOT_FOUND')
  })
})
