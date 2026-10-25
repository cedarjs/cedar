import { describe, expect, it } from 'vitest'

import {
  enablePackagesWorkspace,
  permissionsPackageFiles,
} from '../permissionsPackage.js'

describe('enablePackagesWorkspace', () => {
  it('adds the table when there is none', () => {
    expect(enablePackagesWorkspace('[web]\n  port = 8910\n')).toBe(
      '[web]\n  port = 8910\n\n[experimental.packagesWorkspace]\n  enabled = true\n',
    )
  })

  it('turns it on when it is off', () => {
    const toml = [
      '[experimental.packagesWorkspace]',
      '  enabled = false',
      '',
      '[api]',
      '  port = 8911',
    ].join('\n')

    expect(enablePackagesWorkspace(toml)).toBe(
      toml.replace('enabled = false', 'enabled = true'),
    )
  })

  it("adds enabled to a table that doesn't have it", () => {
    const toml = [
      '[experimental.packagesWorkspace]',
      '[experimental.packagesWorkspace.pipeline]',
      '  skipWatchWarning = true',
    ].join('\n')

    expect(enablePackagesWorkspace(toml)).toBe(
      [
        '[experimental.packagesWorkspace]',
        '  enabled = true',
        '[experimental.packagesWorkspace.pipeline]',
        '  skipWatchWarning = true',
      ].join('\n'),
    )
  })

  it('only changes enabled in its own table', () => {
    const toml = [
      '[experimental.packagesWorkspace]',
      '  enabled = false',
      '[experimental.realtime]',
      '  enabled = false',
    ].join('\n')

    expect(enablePackagesWorkspace(toml)).toBe(
      [
        '[experimental.packagesWorkspace]',
        '  enabled = true',
        '[experimental.realtime]',
        '  enabled = false',
      ].join('\n'),
    )
  })

  it('returns null when it is already on', () => {
    expect(
      enablePackagesWorkspace(
        '[experimental.packagesWorkspace]\n  enabled = true\n',
      ),
    ).toBe(null)
    expect(
      enablePackagesWorkspace(
        '[experimental]\n  packagesWorkspace.enabled = true\n',
      ),
    ).toBe(null)
  })

  it('throws rather than editing a setting it did not find a table for', () => {
    expect(() =>
      enablePackagesWorkspace(
        '[experimental]\n  packagesWorkspace.enabled = false\n',
      ),
    ).toThrow('CEDAR_TENANCY_ERR_PACKAGES_WORKSPACE')
  })
})

describe('permissionsPackageFiles', () => {
  const files = permissionsPackageFiles({
    packageName: '@my-app/permissions',
    cedarVersion: '1.2.3',
    indexSource: 'export const permissions = {}\n',
  })

  it('depends on the same @cedarjs/tenancy version as the app', () => {
    const packageJson = JSON.parse(files['package.json'])

    expect(packageJson.name).toBe('@my-app/permissions')
    expect(packageJson.dependencies['@cedarjs/tenancy']).toBe('1.2.3')
    // `cedar dev` only watches packages with a watch script
    expect(packageJson.scripts.watch).toBeDefined()
  })

  it('writes the index source as is', () => {
    expect(files['src/index.ts']).toBe('export const permissions = {}\n')
  })
})
