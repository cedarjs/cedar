// An app with tenancy, as `cedar generate types` marks it. In a project of
// its own (see tsconfig.json here), so the other type tests don't see it.
import { expect, test } from 'tstyche'

import { createAuthentication } from '@cedarjs/auth'
import type { AuthImplementation } from '@cedarjs/auth'
import { PrivateSet, Router, Set } from '@cedarjs/router'
import type { Tenancy } from '@cedarjs/router'

declare module '@cedarjs/auth' {
  interface AuthTenancy {
    enabled: true
  }

  interface AvailablePermissions {
    'members.manage': true
    'a.b': true
  }
}

// An app's auth, with type parameters of its own like a real provider's
declare const authImplementation: AuthImplementation<
  { sub: string },
  void,
  { username: string; password: string },
  { id: string },
  void,
  void,
  { username: string; password: string },
  { id: string }
>

const { useAuth } = createAuthentication(authImplementation)

test('useAuth() has no hasRole', () => {
  expect(useAuth()).type.not.toHaveProperty('hasRole')
})

test('useAuth().hasUserRole checks currentUser.roles', () => {
  expect(useAuth().hasUserRole).type.toBeCallableWith('admin')
  expect(useAuth().hasUserRole).type.toBeCallableWith(['admin', 'editor'])
})

test("Router takes the app's useAuth", () => {
  expect(<Router useAuth={useAuth}>{null}</Router>).type.not.toRaiseError()
})

// What `createTenancy` from `@cedarjs/tenancy/web` returns, which the router
// doesn't depend on
declare const tenancy: Tenancy

test("Router takes tenancy's tenancy", () => {
  expect(
    <Router useAuth={useAuth} tenancy={tenancy}>
      {null}
    </Router>,
  ).type.not.toRaiseError()
})

test('PrivateSet and Set have no roles', () => {
  expect(
    <PrivateSet unauthenticated="login" roles="admin">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Property 'roles' does not exist")

  expect(
    <Set private unauthenticated="login" roles={['admin']}>
      {null}
    </Set>,
  ).type.toRaiseError("Property 'roles' does not exist")

  expect(
    <PrivateSet unauthenticated="login">{null}</PrivateSet>,
  ).type.not.toRaiseError()
})

test('PrivateSet takes userRoles instead, and no orgRoles', () => {
  expect(
    <PrivateSet unauthenticated="login" userRoles={['admin', 'editor']}>
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet unauthenticated="login" orgRoles="owner">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Property 'orgRoles' does not exist")
})

test('PrivateSet takes orgPermission', () => {
  expect(
    <PrivateSet
      unauthenticated="login"
      unauthorized="projects"
      orgPermission="members.manage"
    >
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet unauthenticated="login" userRoles="staff" orgPermission="a.b">
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet unauthenticated="login" orgPermission={['a.b']}>
      {null}
    </PrivateSet>,
  ).type.toRaiseError()
})
