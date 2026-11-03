import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { dedent } from 'ts-dedent'
import { afterEach, describe, expect, it } from 'vitest'

import {
  enablePackagesWorkspace,
  permissionsPackageFiles,
  permissionsPackageName,
  writePermissionsPackageFiles,
} from '../permissionsPackage.js'

describe('enablePackagesWorkspace', () => {
  it('adds the table when there is none', () => {
    const toml = dedent`
      [web]
        port = 8910
    `

    expect(enablePackagesWorkspace(toml + '\n')).toBe(
      dedent`
        [web]
          port = 8910

        [experimental.packagesWorkspace]
          enabled = true
      ` + '\n',
    )
  })

  it('turns it on when it is off', () => {
    const toml = dedent`
      [experimental.packagesWorkspace]
        enabled = false

      [api]
        port = 8911
    `

    expect(enablePackagesWorkspace(toml)).toBe(
      toml.replace('enabled = false', 'enabled = true'),
    )
  })

  it("adds enabled to a table that doesn't have it", () => {
    const toml = dedent`
      [experimental.packagesWorkspace]
      [experimental.packagesWorkspace.pipeline]
        skipWatchWarning = true
    `

    expect(enablePackagesWorkspace(toml)).toBe(dedent`
      [experimental.packagesWorkspace]
        enabled = true
      [experimental.packagesWorkspace.pipeline]
        skipWatchWarning = true
    `)
  })

  it('only changes enabled in its own table', () => {
    const toml = dedent`
      [experimental.packagesWorkspace]
        enabled = false
      [experimental.realtime]
        enabled = false
    `

    expect(enablePackagesWorkspace(toml)).toBe(dedent`
      [experimental.packagesWorkspace]
        enabled = true
      [experimental.realtime]
        enabled = false
    `)
  })

  it('returns null when it is already on', () => {
    expect(
      enablePackagesWorkspace(dedent`
        [experimental.packagesWorkspace]
          enabled = true
      `),
    ).toBe(null)
    expect(
      enablePackagesWorkspace(dedent`
        [experimental]
          packagesWorkspace.enabled = true
      `),
    ).toBe(null)
  })

  it('throws rather than editing a setting it did not find a table for', () => {
    expect(() =>
      enablePackagesWorkspace(dedent`
        [experimental]
          packagesWorkspace.enabled = false
      `),
    ).toThrow('CEDAR_PERMISSIONS_ERR_PACKAGES_WORKSPACE')
  })
})

describe('permissionsPackageFiles', () => {
  const files = permissionsPackageFiles({
    packageName: '@my-app/permissions',
    cedarVersion: '1.2.3',
    indexSource: 'export const permissions = {}\n',
  })

  it('depends on the same @cedarjs/permissions version as the app', () => {
    const packageJson = JSON.parse(files['package.json'])

    expect(packageJson.name).toBe('@my-app/permissions')
    expect(packageJson.dependencies['@cedarjs/permissions']).toBe('1.2.3')
    // `cedar dev` only watches packages with a watch script
    expect(packageJson.scripts.watch).toBeDefined()
  })

  it('writes the index source as is', () => {
    expect(files['src/index.ts']).toBe('export const permissions = {}\n')
  })
})

describe('permissionsPackageName', () => {
  const dirs: string[] = []

  const packagesDir = (packages: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-packages-'))
    dirs.push(dir)

    for (const [folder, name] of Object.entries(packages)) {
      fs.mkdirSync(path.join(dir, folder))
      fs.writeFileSync(
        path.join(dir, folder, 'package.json'),
        JSON.stringify({ name }),
      )
    }

    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("uses the scope of the app's other packages", () => {
    expect(
      permissionsPackageName(packagesDir({ validators: '@my-org/validators' })),
    ).toBe('@my-org/permissions')
  })

  it("keeps the permissions package's own name", () => {
    expect(
      permissionsPackageName(
        packagesDir({
          permissions: '@acme/permissions',
          validators: '@my-org/validators',
        }),
      ),
    ).toBe('@acme/permissions')
  })

  it('skips unscoped packages', () => {
    expect(
      permissionsPackageName(
        packagesDir({ a: 'plain', b: '@my-org/validators' }),
      ),
    ).toBe('@my-org/permissions')
  })
})

describe('writePermissionsPackageFiles', () => {
  let projectDir: string

  afterEach(() => {
    delete process.env.CEDAR_CWD
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('keeps files that are already there, unless forced', () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-permissions-'))
    fs.writeFileSync(path.join(projectDir, 'cedar.toml'), '')
    process.env.CEDAR_CWD = projectDir

    const packageDir = path.join(projectDir, 'packages', 'permissions')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, 'package.json'), 'edited')

    const files = { 'package.json': 'new', 'tsconfig.json': 'new' }
    const read = (file: string) =>
      fs.readFileSync(path.join(packageDir, file), 'utf-8')

    expect(
      writePermissionsPackageFiles(packageDir, files, { force: false }),
    ).toEqual([path.join(packageDir, 'package.json')])
    expect(read('package.json')).toBe('edited')
    expect(read('tsconfig.json')).toBe('new')

    expect(
      writePermissionsPackageFiles(packageDir, files, { force: true }),
    ).toEqual([])
    expect(read('package.json')).toBe('new')
  })
})
