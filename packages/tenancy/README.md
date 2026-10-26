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

## Auth helpers

```ts
// api/src/lib/auth.ts, in place of the single-tenant hasRole/requireAuth
import { createTenancyAuth } from '@cedarjs/tenancy'

export const { hasRole, hasOrgRole, requireUserAuth, requireOrgAuth } =
  createTenancyAuth()

// In a service:
requireOrgAuth({ roles: ['owner', 'admin'] }) // in the current organization
requireUserAuth() // signed in, no organization needed

// Anywhere:
if (hasOrgRole('owner')) { ... } // in the current organization
if (hasRole('superuser')) { ... } // currentUser.roles
```

`requireOrgAuth` (and the `@requireOrgAuth` directive `setup tenancy` adds) is
about the current organization: it throws `AuthenticationError` with no
current user, and `ForbiddenError` with no current organization or when the
user's role there isn't one of `roles` when they're given. With no `roles`,
any member gets in. `requireUserAuth` (and `@requireUserAuth`) is for fields about the user
rather than an organization: it needs a signed-in user, and checks `roles`
against `currentUser.roles`. `hasOrgRole` and `hasRole` are the boolean
checks to match. There's no `requireAuth`.

## Permissions

```ts
// packages/permissions/src/index.ts, shared by the api and web sides
import { definePermissions } from '@cedarjs/tenancy/permissions'

export const permissions = definePermissions({
  permissions: ['projects.read', 'projects.edit', 'members.manage'],
  roles: {
    owner: ['projects.read', 'projects.edit', 'members.manage'],
    member: ['projects.read'],
  },
})
```

```ts
// api/src/lib/permissions.ts
import { createPermissions } from '@cedarjs/tenancy'

import { permissions } from '@my-app/permissions'

export const { hasPermission, requirePermission, withPermissions } =
  createPermissions(permissions)
```

Roles map to permissions in one place; fields ask for a permission with
`@requirePermission(permission: "projects.edit")` or `requirePermission()`.
A role only gets what its list says, so a new role is one entry. Permission
names are typed from the definitions. `withPermissions` in `getCurrentUser` gives each
membership its permissions, which `useAuth().hasPermission()` checks inside
`OrgScope`. Every permission is about an organization: fields about the user
rather than an organization use `@requireUserAuth`.

## Web

`@cedarjs/tenancy/web` exports `OrgScope`, `useCurrentOrg` and
`getMemberships`/`hasOrgRole` for the client side: a per-organization Apollo
client provided under organization routes, keyed by the immutable organization
id so switching organizations never mixes caches. `useCurrentOrg().hasOrgRole`
checks the user's role in the organization, and `OrgScope`'s `roles` and
`unauthorized` props guard routes by it. `useAuth().hasRole` and
`<PrivateSet roles>` check `currentUser.roles`, as in any Cedar app. See the
how-to for the full
`<Set wrap={OrgScope}>` setup `yarn cedar setup tenancy` generates.
