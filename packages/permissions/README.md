# @cedarjs/permissions

Permissions for a Cedar app: who may do what, defined in one place. A role is a
named bundle of permissions. Fields, services and components check a permission,
never a role, so a role can do exactly what its list says, and a field added
later is closed to it unless its permission is on the list.

`yarn cedar setup permissions` sets this up. In an app with tenancy
(`yarn cedar setup tenancy`), `@cedarjs/tenancy` checks the same definitions
against the user's role in the current organization.

## Defining permissions

The definitions live in the app's `packages/permissions`, shared by the api and
web sides:

```ts
// packages/permissions/src/index.ts
import { definePermissions } from '@cedarjs/permissions'
import type { PermissionName } from '@cedarjs/permissions'

const reader = ['posts.read'] as const

export const permissions = definePermissions({
  permissions: ['posts.read', 'posts.edit', 'users.manage'],
  roles: {
    admin: [...reader, 'posts.edit', 'users.manage'],
    editor: [...reader, 'posts.edit'],
    reader,
  },
})

export type Permission = PermissionName<typeof permissions>
```

The explicit `permissions` list makes a typo in a role's list a type error (and
an error at runtime) instead of a new permission. A role the definitions don't
list has no permissions.

`@cedarjs/permissions` is plain data and functions with no api code in it, so
the web can import it too. It also exports:

- `permissionsOf(definitions, roles)`: the permissions of a role, or of a list
  of roles (their union). The one place a role becomes permissions.
- `coversRole(definitions, held, role)`: whether the permissions in `held`
  include every permission of `role`.
- `isPermission(definitions, name)` and `assertPermission(definitions, name)`:
  whether `name` is defined, as a type guard or an assertion.

## Checking permissions on the api

`createPermissions` from `@cedarjs/permissions/api` checks the signed-in user's
permissions: those of their roles, in `currentUser.roles` (one role or a list of
them).

```ts
// api/src/lib/permissions.ts
import { createPermissions } from '@cedarjs/permissions/api'

import { permissions } from '@my-app/permissions'

export const {
  hasPermission,
  requirePermission,
  canGrantRole,
  permissionsOf,
  withPermissions,
} = createPermissions(permissions)
```

- `hasPermission('posts.edit')`: whether one of the user's roles has it. False
  when no one is signed in.
- `requirePermission('posts.edit')`: throws `AuthenticationError` when no one is
  signed in, and `ForbiddenError` when they may not.
- `canGrantRole(role)`: whether the user may give someone `role`, or take it
  away: they hold every permission it has, so no one can hand out more than they
  may do themselves. False for a role the definitions don't list.
- `permissionsOf(user)`: the permissions of `user.roles`.
- `withPermissions(user)`: `user` with a `permissions` list added, for
  `getCurrentUser` to return.

Permission names are typed from the definitions, so a typo in a service is a
type error. A name that isn't defined (a typo in an SDL directive) throws.

Fields use the `@requirePermission` directive that setup adds:

```graphql
type Mutation {
  updatePost(id: Int!, input: UpdatePostInput!): Post!
    @requirePermission(permission: "posts.edit")
}
```

## On the web

`getCurrentUser` returns the user through `withPermissions`, so
`currentUser.permissions` has the user's permissions, and
`useAuth().hasPermission('posts.edit')` and
`<PrivateSet permission="posts.edit">` check them. The web only decides what to
show; the api's checks are the guard.

## In tests

`mockCurrentUser({ roles: ['editor'] })` gives the user the permissions the
app's definitions give `editor`, on the api and on the web.
