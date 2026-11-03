import { describe, expectTypeOf, test } from 'vitest'

import type {
  AuthContextInterface,
  CurrentUser,
  LoggedInUser,
  PermissionName,
} from '../AuthContext.js'

describe('LoggedInUser', () => {
  test('has no index signature when nothing augments it', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- asserting LoggedInUser is exactly the empty-object shape, not `{ [key: string]: unknown }`
    expectTypeOf<LoggedInUser>().toEqualTypeOf<{}>()
  })

  test('an interface-typed custom user is assignable to CurrentUser', () => {
    // This is the shape the generated-types docs show for a project's own
    // `getCurrentUser` return type. TypeScript only lets an interface satisfy
    // a type with an index signature when the interface declares one too, so
    // this checks that `LoggedInUser` has no index signature.
    interface MyCurrentUser {
      id: number
      email: string
    }

    expectTypeOf<MyCurrentUser>().toMatchTypeOf<CurrentUser>()
  })

  test('primitives are not assignable to CurrentUser', () => {
    expectTypeOf<string>().not.toMatchTypeOf<CurrentUser>()
    expectTypeOf<number>().not.toMatchTypeOf<CurrentUser>()
  })

  test('object literals and type aliases are still assignable', () => {
    type MyCurrentUser = { id: number; email: string }

    expectTypeOf<MyCurrentUser>().toMatchTypeOf<CurrentUser>()
    expectTypeOf({ id: 1, email: 'a@example.com' }).toMatchTypeOf<CurrentUser>()
  })
})

describe('PermissionName', () => {
  test('is never in an app without permissions', () => {
    expectTypeOf<PermissionName>().toBeNever()
  })

  test('so hasPermission takes no names there', () => {
    type HasPermission = AuthContextInterface<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >['hasPermission']

    expectTypeOf<HasPermission>().parameter(0).toBeNever()
  })
})
