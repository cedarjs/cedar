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

export const { hasRole, requireAuth, hasOrgRole } = createTenancyAuth({
  defaultRoles: ['owner', 'admin', 'member'],
})

// In a service:
requireAuth({ roles: ['owner', 'admin'] }) // in the current organization
requireAuth({ scope: 'USER' }) // signed in, no organization needed

// Anywhere:
if (hasRole('owner')) { ... }
```

`requireAuth` (and the `@requireAuth` directive, which `setup tenancy` gives a
`scope` argument) is about the current organization by default: it throws
`AuthenticationError` with no current user, and `ForbiddenError` with no
current organization or when the user's role there isn't one of `roles`, or of
`defaultRoles` when none are given. `scope: 'USER'` is for fields about the
user rather than an organization. `hasRole` checks `getCurrentRoles()`: the
membership's role in the current organization, or `currentUser.roles` outside
one.

## Permissions

```ts
// api/src/lib/permissions.ts
export const { hasPermission, requirePermission, withPermissions } =
  createPermissions({
    roles: {
      owner: ['projects.read', 'projects.edit', 'members.manage'],
      member: ['projects.read'],
    },
    user: ['account.manage'],
  })
```

Roles map to permissions in one place; fields ask for a permission with
`@requirePermission(permission: "projects.edit")` or `requirePermission()`.
A role only gets what its list says, so a new role is one entry. Permission
names are typed from the map. `withPermissions` in `getCurrentUser` gives each
membership its permissions, which `useAuth().hasPermission()` checks inside
`OrgScope`.

## Web

`@cedarjs/tenancy/web` exports `OrgScope`, `useCurrentOrg`, `OrgContext` and
`getMemberships`/`hasOrgRole` for the client side: a per-organization Apollo
client provided under organization routes, keyed by the immutable organization
id so switching organizations never mixes caches. Under `OrgScope`,
`useAuth().hasRole` checks the user's role in that organization, and
`OrgScope`'s `roles` and `unauthorized` props guard routes by it. See the how-to for the full
`<Set wrap={OrgScope}>` setup `yarn cedar setup tenancy` generates.
