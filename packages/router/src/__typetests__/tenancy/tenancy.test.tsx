// An app with tenancy, as `cedar generate types` marks it. In a project of
// its own (see tsconfig.json here), so the other type tests don't see it.
import { expect, test } from 'tstyche'

import { createAuthentication } from '@cedarjs/auth'
import type { AuthImplementation } from '@cedarjs/auth'
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

test('useAuth().hasRole takes no roles', () => {
  expect(useAuth().hasRole).type.not.toBeCallableWith('admin')
  expect(useAuth().hasRole).type.not.toBeCallableWith(['admin'])
})

test('useAuth().hasUserRole checks currentUser.roles', () => {
  expect(useAuth().hasUserRole).type.toBeCallableWith('admin')
  expect(useAuth().hasUserRole).type.toBeCallableWith(['admin', 'editor'])
})

test("Router takes the app's useAuth", () => {
  expect(<Router useAuth={useAuth}>{null}</Router>).type.not.toRaiseError()
})

test('PrivateSet and Set take no roles', () => {
  expect(
    <PrivateSet unauthenticated="login" roles="admin">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Type 'string' is not assignable to type 'undefined'")

  expect(
    <Set private unauthenticated="login" roles={['admin']}>
      {null}
    </Set>,
  ).type.toRaiseError("Type 'string[]' is not assignable to type 'undefined'")

  expect(
    <PrivateSet unauthenticated="login">{null}</PrivateSet>,
  ).type.not.toRaiseError()
})
