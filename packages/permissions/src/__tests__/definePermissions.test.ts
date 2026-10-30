import { describe, expect, it } from 'vitest'

import {
  assertPermission,
  coversRole,
  definePermissions,
  isPermission,
  permissionsOf,
} from '../index.js'

const definitions = definePermissions({
  permissions: ['posts.read', 'posts.edit', 'users.manage'],
  roles: {
    admin: ['posts.read', 'posts.edit', 'users.manage'],
    editor: ['posts.read', 'posts.edit'],
    reader: ['posts.read'],
  },
})

describe('definePermissions', () => {
  it('throws for a role listing a permission that is not defined', () => {
    expect(() =>
      definePermissions({
        permissions: ['posts.read'],
        // @ts-expect-error - a typo is a type error too
        roles: { admin: ['posts.raed'] },
      }),
    ).toThrow('Unknown permission "posts.raed" in role "admin"')
  })
})

describe('permissionsOf', () => {
  it("is a role's permissions", () => {
    expect(permissionsOf(definitions, 'reader')).toEqual(['posts.read'])
  })

  it('is the union of a list of roles, once each', () => {
    expect(permissionsOf(definitions, ['reader', 'editor'])).toEqual([
      'posts.read',
      'posts.edit',
    ])
  })

  it('is empty for roles the definitions do not list, or no roles', () => {
    expect(permissionsOf(definitions, 'constructor')).toEqual([])
    expect(permissionsOf(definitions, ['toString'])).toEqual([])
    expect(permissionsOf(definitions, null)).toEqual([])
    expect(permissionsOf(definitions, undefined)).toEqual([])
  })
})

describe('isPermission and assertPermission', () => {
  it('know the defined names', () => {
    expect(isPermission(definitions, 'posts.read')).toBe(true)
    expect(isPermission(definitions, 'posts.raed')).toBe(false)
    expect(isPermission(definitions, undefined)).toBe(false)
    expect(() => assertPermission(definitions, 'posts.read')).not.toThrow()
    expect(() => assertPermission(definitions, 'posts.raed')).toThrow(
      'Unknown permission "posts.raed"',
    )
  })
})

describe('coversRole', () => {
  it('is whether the permissions include all of the role’s', () => {
    expect(
      coversRole(definitions, ['posts.read', 'posts.edit'], 'editor'),
    ).toBe(true)
    expect(coversRole(definitions, ['posts.read'], 'editor')).toBe(false)
  })

  it('is false for a role the definitions do not list', () => {
    expect(coversRole(definitions, ['posts.read'], 'constructor')).toBe(false)
    expect(coversRole(definitions, ['posts.read'], 'toString')).toBe(false)
  })
})
