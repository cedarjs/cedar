import { expect, test } from 'tstyche'

import { createAuthentication } from '@cedarjs/auth'
import type { AuthImplementation } from '@cedarjs/auth'
import { PrivateSet, Router } from '@cedarjs/router'
import type { Tenancy } from '@cedarjs/router'

// Without tenancy: see tenancy/ for an app with it
declare const authImplementation: AuthImplementation<{ sub: string }>

const { useAuth } = createAuthentication(authImplementation)

test('useAuth().hasRole checks currentUser.roles', () => {
  expect(useAuth().hasRole).type.toBeCallableWith('admin')
  expect(useAuth().hasRole).type.toBeCallableWith(['admin', 'editor'])
})

test('useAuth() has no hasUserRole', () => {
  expect(useAuth()).type.not.toHaveProperty('hasUserRole')
})

test("Router takes the app's useAuth", () => {
  expect(<Router useAuth={useAuth}>{null}</Router>).type.not.toRaiseError()
})

declare const tenancy: Tenancy

test('Router has no tenancy', () => {
  expect(
    <Router useAuth={useAuth} tenancy={tenancy}>
      {null}
    </Router>,
  ).type.toRaiseError("Property 'tenancy' does not exist")
})

test('PrivateSet takes roles', () => {
  expect(
    <PrivateSet unauthenticated="login" roles={['admin', 'editor']}>
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()
})

test('PrivateSet takes unauthorized', () => {
  expect(
    <PrivateSet unauthenticated="login" unauthorized="forbidden" roles="admin">
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()
})

test('PrivateSet has no userRoles, orgRoles or orgPermission', () => {
  expect(
    <PrivateSet unauthenticated="login" userRoles="admin">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Property 'userRoles' does not exist")

  expect(
    <PrivateSet unauthenticated="login" orgRoles="owner">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Property 'orgRoles' does not exist")

  expect(
    <PrivateSet unauthenticated="login" orgPermission="members.manage">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Property 'orgPermission' does not exist")
})
