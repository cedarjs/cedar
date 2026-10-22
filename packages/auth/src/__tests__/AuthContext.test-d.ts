import { describe, expectTypeOf, test } from 'vitest'

import type { CurrentUser, LoggedInUser } from '../AuthContext.js'

describe('LoggedInUser', () => {
  test('has no index signature when nothing augments it', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- asserting LoggedInUser is exactly the empty-object shape, not `{ [key: string]: unknown }`
    expectTypeOf<LoggedInUser>().toEqualTypeOf<{}>()
  })

  test('an interface-typed custom user is assignable to CurrentUser', () => {
    // This is the shape the generated-types docs show for a project's own
    // `getCurrentUser` return type. Before the index signature was removed,
    // an interface like this (as opposed to a type alias) wasn't assignable
    // to `LoggedInUser`/`CurrentUser` because TypeScript only lets an
    // interface satisfy a type with an index signature when the interface
    // declares one too.
    interface MyCurrentUser {
      id: number
      email: string
    }

    expectTypeOf<MyCurrentUser>().toMatchTypeOf<CurrentUser>()
  })

  test('object literals and type aliases are still assignable', () => {
    type MyCurrentUser = { id: number; email: string }

    expectTypeOf<MyCurrentUser>().toMatchTypeOf<CurrentUser>()
    expectTypeOf({ id: 1, email: 'a@example.com' }).toMatchTypeOf<CurrentUser>()
  })
})
