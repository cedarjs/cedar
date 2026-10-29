import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { belongsToOrganization, withAuthDirective } from '../authDirective.js'

let directivesDir: string
let libDir: string

vi.mock('../index.js', () => ({
  getPaths: () => ({ api: { directives: directivesDir, lib: libDir } }),
}))

const sdl = 'todos: [Todo!]! @requireAuth @requireAuthor'

describe('withAuthDirective', () => {
  beforeEach(() => {
    directivesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-test-'))
  })

  afterEach(() => {
    fs.rmSync(directivesDir, { recursive: true, force: true })
  })

  it('leaves @requireAuth in an app without tenancy', () => {
    expect(withAuthDirective(sdl, { belongsToOrg: true })).toBe(sdl)
  })

  it("switches to tenancy's directives once tenancy has replaced it", () => {
    fs.mkdirSync(path.join(directivesDir, 'requireUserAuth'))

    expect(withAuthDirective(sdl, { belongsToOrg: true })).toBe(
      'todos: [Todo!]! @requirePermission(permission: "organization.read") @requireAuthor',
    )
    expect(withAuthDirective(sdl, { belongsToOrg: false })).toBe(
      'todos: [Todo!]! @requireUserAuth @requireAuthor',
    )
  })
})

describe('belongsToOrganization', () => {
  beforeEach(() => {
    libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-test-'))
  })

  afterEach(() => {
    fs.rmSync(libDir, { recursive: true, force: true })
  })

  it('is true for a model with organizationId or an Organization relation', () => {
    expect(
      belongsToOrganization({
        fields: [{ name: 'organizationId', type: 'String' }],
      }),
    ).toBe(true)
    expect(
      belongsToOrganization({
        fields: [{ name: 'org', type: 'Organization' }],
      }),
    ).toBe(true)
    expect(
      belongsToOrganization({ fields: [{ name: 'userId', type: 'String' }] }),
    ).toBe(false)
  })

  it("uses the app's own tenant field", () => {
    fs.writeFileSync(
      path.join(libDir, 'db.ts'),
      "createTenancyExtension({ tenantField: 'accountId' })",
    )

    expect(
      belongsToOrganization({
        fields: [{ name: 'accountId', type: 'String' }],
      }),
    ).toBe(true)
    expect(
      belongsToOrganization({
        fields: [{ name: 'organizationId', type: 'String' }],
      }),
    ).toBe(false)
  })
})
