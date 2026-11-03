import { expect, test } from 'tstyche'

import { definePermissions } from '@cedarjs/permissions'
import type { PermissionName } from '@cedarjs/permissions'
import { createPermissions } from '@cedarjs/permissions/api'

const definitions = definePermissions({
  permissions: ['posts.read', 'posts.edit'],
  roles: {
    admin: ['posts.read', 'posts.edit'],
    reader: ['posts.read'],
  },
})

const permissions = createPermissions(definitions)

// tstyche only type-checks this file, so a declaration is enough
declare const maybeUser: { id: number; roles: string[] } | null

test('the permission names are typed from the definitions', () => {
  expect<PermissionName<typeof definitions>>().type.toBe<
    'posts.read' | 'posts.edit'
  >()
})

test('a role can only list defined permissions', () => {
  expect(definePermissions).type.not.toBeCallableWith({
    permissions: ['posts.read'],
    roles: { admin: ['posts.raed'] },
  })
})

test('the checks only take defined permissions', () => {
  expect(permissions.hasPermission).type.toBeCallableWith('posts.read')
  expect(permissions.hasPermission).type.not.toBeCallableWith('posts.raed')
  expect(permissions.requirePermission).type.toBeCallableWith('posts.edit')
  expect(permissions.requirePermission).type.not.toBeCallableWith('posts.raed')
})

test('canGrantRole takes any role name', () => {
  expect(permissions.canGrantRole).type.toBeCallableWith('anything')
})

test('withPermissions adds typed permissions to the user', () => {
  const user = { id: 1, roles: ['admin'] }

  expect(permissions.withPermissions(user)).type.toBe<
    { id: number; roles: string[] } & {
      permissions: ('posts.read' | 'posts.edit')[]
    }
  >()
  expect(permissions.withPermissions(maybeUser)).type.toBe<
    | ({ id: number; roles: string[] } & {
        permissions: ('posts.read' | 'posts.edit')[]
      })
    | null
  >()
})
