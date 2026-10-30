import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadAppPermissions } from '../loadAppPermissions.js'
import {
  setMockPermissionDefinitions,
  withMockPermissions,
} from '../mockPermissions.js'

const definitions = {
  permissions: ['posts.read', 'posts.edit', 'users.manage'],
  roles: {
    admin: ['posts.read', 'posts.edit', 'users.manage'],
    editor: ['posts.read', 'posts.edit'],
  },
}

describe('withMockPermissions', () => {
  afterEach(() => setMockPermissionDefinitions(undefined))

  it("adds the permissions of the user's roles", () => {
    setMockPermissionDefinitions(definitions)

    expect(withMockPermissions({ id: 1, roles: ['editor'] })).toEqual({
      id: 1,
      roles: ['editor'],
      permissions: ['posts.read', 'posts.edit'],
    })
    expect(withMockPermissions({ roles: 'admin' })).toEqual({
      roles: 'admin',
      permissions: ['posts.read', 'posts.edit', 'users.manage'],
    })
  })

  it('keeps permissions the user has, and users without roles', () => {
    setMockPermissionDefinitions(definitions)

    expect(
      withMockPermissions({ roles: ['admin'], permissions: ['posts.read'] }),
    ).toEqual({ roles: ['admin'], permissions: ['posts.read'] })
    expect(withMockPermissions({ id: 1 })).toEqual({ id: 1 })
  })

  it('leaves the user as it is without definitions', () => {
    expect(withMockPermissions({ roles: ['admin'] })).toEqual({
      roles: ['admin'],
    })
  })
})

describe('loadAppPermissions', () => {
  let projectDir: string
  const originalCwd = process.env.CEDAR_CWD

  const write = (file: string, content: unknown) => {
    const filePath = path.join(projectDir, file)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      typeof content === 'string' ? content : JSON.stringify(content),
    )
  }

  beforeEach(() => {
    projectDir = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'cedar-permissions-'),
    )
    process.env.CEDAR_CWD = projectDir
    write('cedar.toml', '')
    write('packages/permissions/package.json', { name: '@my-app/permissions' })
    // As the workspace links it into the side's node_modules
    write('web/node_modules/@my-app/permissions/package.json', {
      name: '@my-app/permissions',
      type: 'module',
      exports: { '.': { default: './index.js' } },
    })
    write(
      'web/node_modules/@my-app/permissions/index.js',
      `export const permissions = ${JSON.stringify(definitions)}`,
    )
  })

  afterEach(() => {
    process.env.CEDAR_CWD = originalCwd
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it("loads the app's definitions as the side imports them", async () => {
    write('web/package.json', {
      dependencies: { '@my-app/permissions': 'workspace:*' },
    })

    expect(await loadAppPermissions(path.join(projectDir, 'web'))).toEqual(
      definitions,
    )
  })

  it('is undefined when the side has tenancy', async () => {
    write('web/package.json', {
      dependencies: {
        '@cedarjs/tenancy': '1.0.0',
        '@my-app/permissions': 'workspace:*',
      },
    })

    expect(await loadAppPermissions(path.join(projectDir, 'web'))).toBe(
      undefined,
    )
  })

  it("is undefined when the side doesn't use the package", async () => {
    write('web/package.json', { dependencies: {} })

    expect(await loadAppPermissions(path.join(projectDir, 'web'))).toBe(
      undefined,
    )
  })
})
