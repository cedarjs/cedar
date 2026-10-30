---
description: Who may do what, as permissions that roles bundle
---

# Permissions

A permission names something a user may do, such as `posts.edit`. A role is a
named bundle of permissions, defined in one map. Fields, services and components
check a permission, never a role, so a role can do exactly what its entry in the
map says, and a field added later is closed to it unless its permission is on
the list. Adding a role is one entry in the map instead of an edit to every
field it should reach.

Roles are still what's stored on a user (`currentUser.roles`), what people
grant, what the UI shows, and the key into the map. Checks ask for a permission
instead.

This page is about an app without [tenancy](tenancy.md). With tenancy, the same
map, directive and checks work per organization: see
[Permissions](tenancy.md#permissions) in the tenancy docs.

## Setup

```bash
yarn cedar setup permissions
```

It needs auth set up first. It adds:

- `packages/permissions`, the map, in a package both sides share: the api checks
  the permissions, and the web can import their names. It turns on
  `experimental.packagesWorkspace` in `cedar.toml` for it.
- `api/src/lib/permissions`, with the checks.
- The `@requirePermission` directive, and a test for it.
- `withPermissions` around what `getCurrentUser` in `api/src/lib/auth` returns,
  so `currentUser.permissions` reaches the web.

Each role that the app's role lists name gets an entry in the map, with no
permissions yet: `@requireAuth(roles: [...])` in SDL files,
`requireAuth({ roles })` and `hasRole(...)` in api code, and
`<PrivateSet roles>` and `hasRole(...)` on the web. Only roles written as string
literals are found. Without any, the map is an example.

Fields with a `roles` list check those roles. Moving each to a permission takes
a name for what it allows, so that's for you to choose.

Running it again keeps the files an earlier run wrote. `--force` overwrites
them.

## The map

```ts title="packages/permissions/src/index.ts"
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

- `permissions`: every permission the app checks, by name. A role listing a name
  that isn't here is a type error, and `definePermissions` throws for it at
  runtime too.
- `roles`: what each role may do. A user may do what any of their roles may do.
  A role that isn't listed may do nothing.

`currentUser.roles` holds the user's roles: one role as a string, or a list of
them. `getCurrentUser` needs to return them, as it does for `hasRole`.

## On the api

```ts title="api/src/lib/permissions.ts"
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

- `hasPermission('posts.edit')`: whether one of the signed-in user's roles has
  the permission. `false` when no one is signed in.
- `requirePermission('posts.edit')`: throws `AuthenticationError` when no one is
  signed in, and `ForbiddenError` when they may not.
- `canGrantRole(role)`: whether the signed-in user may give someone `role`, or
  take it away: they hold every permission it has. Nobody can hand out more than
  they may do themselves. `false` for a role the map doesn't list. Who may
  manage users at all is a permission of its own, such as `users.manage`, on the
  field.
- `permissionsOf(user)`: the permissions of `user.roles`. The checks above all
  use it.
- `withPermissions(user)`: `user` with `permissions` added, for `getCurrentUser`
  to return.

The checks work out the permissions from `currentUser.roles`, on each request.
They go by the roles alone, so a `permissions` field stored on the user record
has no effect on them, and neither does the `currentUser.permissions` that
`withPermissions` adds for the web. Permission names are typed from the map, so a typo in a service is a type error, and a name the
map doesn't define throws.

```ts title="api/src/services/posts/posts.ts"
import { db } from 'src/lib/db'
import { requirePermission } from 'src/lib/permissions'

export const deletePost = ({ id }) => {
  requirePermission('posts.edit')

  return db.post.delete({ where: { id } })
}
```

### `@requirePermission`

```graphql title="api/src/graphql/posts.sdl.ts"
type Mutation {
  updatePost(id: Int!, input: UpdatePostInput!): Post!
    @requirePermission(permission: "posts.edit")
}
```

The directive calls `requirePermission`. `yarn cedar lint` checks the names in
SDL files against the map, so a typo fails the lint.

### `getCurrentUser`

```ts title="api/src/lib/auth.ts"
export const getCurrentUser = async (session) => {
  return withPermissions(
    await db.user.findUnique({
      where: { id: session.id },
      select: { id: true, email: true, roles: true },
    })
  )
}
```

On the web, `currentUser.permissions` is a snapshot from when the user signed
in, which `reauthenticate()` refreshes. On the api, each request's checks work
the permissions out again from that request's `currentUser.roles`.

## On the web

`useAuth().hasPermission('posts.edit')` checks `currentUser.permissions`, and
`<PrivateSet permission>` guards routes with it:

```tsx title="web/src/Routes.tsx"
<PrivateSet
  unauthenticated="login"
  unauthorized="home"
  permission="users.manage"
>
  <Route path="/admin/users" page={UsersPage} name="users" />
</PrivateSet>
```

A user who isn't signed in goes to `unauthenticated`, and one without the
permission to `unauthorized` (or `unauthenticated` when the set has none). With
`roles` as well, a user needs both. `yarn cedar generate types` types the names
from the map, so `hasPermission` and `permission` only take those.

As with every check on the web, these decide what to show. The api's checks
protect the data.

## Testing

In tests, `mockCurrentUser({ roles: ['editor'] })` gives the user the
permissions the map gives `editor`, on the api and the web, so tests check the
real map. The test setup imports the app's permissions package for it. A mocked
user with `permissions` of its own keeps them.

```ts
mockCurrentUser({ id: 1, roles: ['editor'] })

expect(() => deletePost({ id: 1 })).not.toThrow()
```

In Storybook, mock the permissions themselves. A story shows the UI in one
state, and which role grants it is beside the point there:

```tsx title="web/src/components/ContactActions/ContactActions.stories.tsx"
export const CanEdit: Story = {
  render: () => {
    mockCurrentUser({ permissions: ['contacts.edit'] })

    return <ContactActions />
  },
}
```

`useAuth().hasPermission()` checks `currentUser.permissions`, so the story
shows what a user with `contacts.edit` sees.

## Adding tenancy later

`yarn cedar setup tenancy` on an app with permissions changes where a user's
permissions come from: their role in the current organization instead of
`currentUser.roles`. It keeps the map and the `@requirePermission` directive,
and replaces `api/src/lib/permissions` with the membership-based one, so
`@requirePermission` fields, `hasPermission` calls and `<PrivateSet permission>`
sets check the same names, in the current organization. A request needs an
organization for them, and a `<PrivateSet permission>` route an `{orgSlug}`
(see [tenancy on the Router](tenancy.md#tenancy-on-the-router)).

The map's roles are then roles in an organization. Its next steps list the
permissions the generated organizations service checks (`organization.read`,
`organization.manage` and `members.manage`) and the roles to add for them.
