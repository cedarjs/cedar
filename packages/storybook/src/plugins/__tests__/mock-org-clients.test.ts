import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { orgClientsModuleSource } from '../mock-org-clients.js'

describe('orgClientsModuleSource', () => {
  let webBase: string

  beforeEach(() => {
    webBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-sb-web-'))
  })

  afterEach(() => {
    fs.rmSync(webBase, { recursive: true, force: true })
  })

  const writePackageJson = (packageJson: unknown) =>
    fs.writeFileSync(
      path.join(webBase, 'package.json'),
      JSON.stringify(packageJson),
    )

  it("re-exports the app's clearOrgClients when the web side has tenancy", () => {
    writePackageJson({ dependencies: { '@cedarjs/tenancy': '7.1.0' } })

    expect(orgClientsModuleSource(webBase)).toBe(
      "export { clearOrgClients } from '@cedarjs/tenancy/web'",
    )
  })

  it('also finds tenancy in devDependencies', () => {
    writePackageJson({ devDependencies: { '@cedarjs/tenancy': '7.1.0' } })

    expect(orgClientsModuleSource(webBase)).toContain('@cedarjs/tenancy/web')
  })

  it('is a no-op without tenancy', () => {
    writePackageJson({ dependencies: { '@cedarjs/web': '7.1.0' } })

    expect(orgClientsModuleSource(webBase)).toBe(
      'export const clearOrgClients = async () => {}',
    )
  })

  it('is a no-op without a package.json', () => {
    expect(orgClientsModuleSource(webBase)).toBe(
      'export const clearOrgClients = async () => {}',
    )
  })
})
