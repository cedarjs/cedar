// An app with permissions and without tenancy, as `cedar generate types`
// makes it. In a project of its own (see tsconfig.json here), so the other
// type tests don't see it.
import { expect, test } from 'tstyche'

import { createAuthentication } from '@cedarjs/auth'
import type { AuthImplementation } from '@cedarjs/auth'
import { PrivateSet, Router, Set } from '@cedarjs/router'
import type { Tenancy } from '@cedarjs/router'

declare module '@cedarjs/auth' {
  interface AvailablePermissions {
    'posts.edit': true
    'users.manage': true
  }
}

declare const authImplementation: AuthImplementation<{ sub: string }>

const { useAuth } = createAuthentication(authImplementation)

test("useAuth().hasPermission takes the app's permission names", () => {
  expect(useAuth().hasPermission).type.toBeCallableWith('posts.edit')
  expect(useAuth().hasPermission).type.not.toBeCallableWith('posts.raed')
})

test("PrivateSet and Set take the app's permission names", () => {
  expect(
    <PrivateSet
      unauthenticated="login"
      unauthorized="forbidden"
      permission="users.manage"
    >
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <Set private unauthenticated="login" roles="admin" permission="posts.edit">
      {null}
    </Set>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet unauthenticated="login" permission="posts.raed">
      {null}
    </PrivateSet>,
  ).type.toRaiseError()
})

declare const tenancy: Tenancy

test('Router has no tenancy', () => {
  expect(
    <Router useAuth={useAuth} tenancy={tenancy}>
      {null}
    </Router>,
  ).type.toRaiseError("Property 'tenancy' does not exist")
})
