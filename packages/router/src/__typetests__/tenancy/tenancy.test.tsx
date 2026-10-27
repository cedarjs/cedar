// An app with tenancy, as `cedar generate types` marks it. In a project of
// its own (see tsconfig.json here), so the other type tests don't see it.
import { expect, test } from 'tstyche'

import { createAuthentication } from '@cedarjs/auth'
import type { AuthImplementation, UseAuth } from '@cedarjs/auth'
import { PrivateSet, Router, Set } from '@cedarjs/router'

declare module '@cedarjs/auth' {
  interface AuthTenancy {
    enabled: true
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

// `useOrgRoles` from `@cedarjs/tenancy/web`, which the router doesn't depend on
declare function useOrgRoles(
  useAuth: UseAuth,
  params: Record<string, string>,
): ((roles: string | string[]) => boolean) | null

test("Router takes tenancy's useOrgRoles", () => {
  expect(
    <Router useAuth={useAuth} useOrgRoles={useOrgRoles}>
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

test('PrivateSet takes userRoles and orgRoles instead', () => {
  expect(
    <PrivateSet unauthenticated="login" userRoles={['admin', 'editor']}>
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet
      unauthenticated="login"
      unauthorized="projects"
      orgRoles="owner"
    >
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet unauthenticated="login" userRoles="staff" orgRoles={['owner']}>
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()
})
