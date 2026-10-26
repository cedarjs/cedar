import { expect, test } from 'tstyche'

import { createAuthentication } from '@cedarjs/auth'
import type { AuthImplementation } from '@cedarjs/auth'
import { PrivateSet, Router } from '@cedarjs/router'

// Without tenancy: see tenancy/ for an app with it
declare const authImplementation: AuthImplementation<{ sub: string }>

const { useAuth } = createAuthentication(authImplementation)

test('useAuth().hasRole and hasUserRole both check currentUser.roles', () => {
  expect(useAuth().hasRole).type.toBeCallableWith('admin')
  expect(useAuth().hasRole).type.toBeCallableWith(['admin', 'editor'])
  expect(useAuth().hasUserRole).type.toBeCallableWith('admin')
})

test("Router takes the app's useAuth", () => {
  expect(<Router useAuth={useAuth}>{null}</Router>).type.not.toRaiseError()
})

test('PrivateSet takes roles', () => {
  expect(
    <PrivateSet unauthenticated="login" roles={['admin', 'editor']}>
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()
})
