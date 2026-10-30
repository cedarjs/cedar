# @cedarjs/tenancy

Opt-in, row-level multi-tenancy for Cedar apps: organizations, memberships,
per-organization roles and a Prisma client extension that scopes every query on
a tenant-owned model to the current organization.

Set it up with `yarn cedar setup tenancy`. See the
[multi-tenancy how-to](https://cedarjs.com/docs/how-to/multi-tenancy) and the
[reference docs](https://cedarjs.com/docs/tenancy).

## The Prisma extension

`createTenancyExtension()` wraps a Prisma Client so every operation on a
tenant-owned model gets an `organizationId` equality check added to it — `where`
for reads, `data` for writes, and any nested relation reached through
`include`/`select`. A tenant-owned model queried with no organization in scope
throws `TenantScopeError` instead of silently returning unscoped data.

```ts
// api/src/lib/db.ts
import { createTenancyExtension } from '@cedarjs/tenancy'

import { PrismaClient } from './generated/prisma/client'

const prismaClient = new PrismaClient()

export const db = prismaClient.$extends(
  createTenancyExtension<typeof prismaClient>({
    // Every model is tenant-owned except these three, which `setup tenancy`
    // adds to the schema. New models are scoped automatically.
    models: { allExcept: ['user', 'organization', 'membership'] },
  }),
)
```

By default the extension reads the current organization from
`context.currentOrg?.id` (set by `resolveCurrentOrg`/`withTenancy`, below). Pass
`getTenantId` to source it differently, and `tenantField` if the column isn't
named `organizationId`.

### Escape hatches

```ts
db.$forOrg(organizationId) // scoped to one organization, ignoring context
db.$withoutTenant() // unscoped, for seeds, scripts, admin tooling
```

Both share the same underlying connection pool as `db`. Use `$forOrg` in
background jobs and webhooks, where there's no request context but the
organization is known; use `$withoutTenant` for code that intentionally reads or
writes across organizations. Raw SQL (`$queryRaw`, `$executeRaw`, and their
`Unsafe` variants) is blocked on a tenant-scoped client and only available on
`$withoutTenant()`.

## Context helpers

```ts
import {
  resolveCurrentOrg,
  requireCurrentOrg,
  getCurrentOrg,
} from '@cedarjs/tenancy'
```

- `resolveCurrentOrg({ event, variables, currentUser, lookupOrg })` — resolves
  the organization a request targets (the `cedar-org` header, then
  `orgId`/`orgSlug` GraphQL variables), validates the user has a membership in
  it, and sets `context.currentOrg`. Wire it into `createGraphQLHandler`'s
  `context` option.
- `withTenancy(handler, { authDecoder, getCurrentUser, lookupOrg })` — the same
  setup for a plain `api/src/functions/*` handler that doesn't go through the
  GraphQL context.
- `getCurrentOrg()` / `requireCurrentOrg()` — read the organization set on the
  current request; the latter throws `TenantScopeError` when none is set.

## User checks

`hasRole` and `requireAuth` in `api/src/lib/auth.ts`, and the `@requireAuth`
directive, are for fields about the user rather than an organization: their
account, their memberships, accepting an invitation. `requireAuth` needs a
signed-in user, and both check `roles` against `currentUser.roles`: the user's own roles, in
any organization or none. There's no role check on the current
organization: fields about an organization ask for a permission (below).

## Permissions

Roles in an organization are named bundles of permissions, defined in one
place. Fields, services and components check a permission in an
organization, never the membership's role, so a role can do exactly what its
list says. `hasRole` and `<PrivateSet roles>` check the user's own roles, in
`currentUser.roles`.

```ts
// packages/permissions/src/index.ts, shared by the api and web sides
import { definePermissions } from '@cedarjs/tenancy/permissions'

const member = ['organization.read', 'projects.read'] as const

export const permissions = definePermissions({
  permissions: [
    'organization.read',
    'projects.read',
    'projects.edit',
    'members.manage',
  ],
  roles: {
    owner: [...member, 'projects.edit', 'members.manage'],
    member,
  },
})
```

```ts
// api/src/lib/permissions.ts
import { createPermissions } from '@cedarjs/tenancy'

import { permissions } from '@my-app/permissions'

export const {
  hasPermission,
  requirePermission,
  canGrantRole,
  withPermissions,
} = createPermissions(permissions)
```

Fields ask for a permission with `@requirePermission(permission:
"projects.edit")`, and services with `requirePermission('projects.edit')`.
"Any member" is a permission every role lists, such as `organization.read`,
so a new role starts with nothing until its entry says otherwise. Permission
names are typed from the definitions, and an unknown name throws.

`canGrantRole(role)` is whether the signed-in user may give someone `role`,
or take it away: they hold every permission it has. Nobody can hand out more
than they may do themselves, and a new role needs no grant table. It
doesn't check `members.manage`: whoever calls it checks that first, as the
generated `inviteMember` and `removeMember` do with
`@requirePermission(permission: "members.manage")`.

`withPermissions` in `getCurrentUser` gives each membership its permissions,
which `useAuth().hasPermission()` checks inside an organization route.

## Web

`@cedarjs/tenancy/web` exports `createTenancy`, a ready-made `tenancy`,
`useCurrentOrg`, `useOrgBySlug` and `getMemberships` for the client
side. Pass the tenancy to the router and put organization routes in a
`PrivateSet`: the router renders a per-organization Apollo client, keyed by the
immutable organization id so switching organizations never mixes caches, around
the set's layouts and page. `useAuth().hasPermission()` checks what the user
may do in the organization. To guard routes by a permission of the user's
membership, give a `PrivateSet` `orgPermission` and `unauthorized`:

<!-- prettier-ignore -->
```tsx
import { tenancy } from 'src/tenancy'

<Router useAuth={useAuth} tenancy={tenancy}>
  <PrivateSet wrap={OrgLayout} unauthenticated="login">
    <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
  </PrivateSet>
  <PrivateSet wrap={OrgLayout} unauthenticated="login" unauthorized="projects" orgPermission="members.manage">
    <Route path="/org/{orgSlug}/members" page={MembersPage} name="members" />
  </PrivateSet>
</Router>
```

```tsx title="web/src/tenancy.tsx"
import { createTenancy } from '@cedarjs/tenancy/web'

export const tenancy = createTenancy({
  notAMember: <p>You don't have access to this organization.</p>,
})
```

The router checks the permission in the organization that `tenancy.useOrg`
returns. The default `useOrg` finds it by the route's `orgSlug` param, and a
custom one can find it another way, such as from the host. A `PrivateSet` with `orgPermission` throws when
the router has no `tenancy` or its `useOrg` finds no organization for the
route; with the default lookup, that's a route without `{orgSlug}`. A route
with `{orgSlug}` outside a `PrivateSet` is a public page with no organization
context. `useAuth().hasRole` and `<PrivateSet roles>` check
`currentUser.roles`, the user's own roles, as in an app without tenancy;
checks in an organization use a permission. See the
how-to for the full setup `yarn cedar setup tenancy` generates.
