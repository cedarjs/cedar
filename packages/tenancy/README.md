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
import { hasOrgRole, requireMembership } from '@cedarjs/tenancy'

// In a service:
requireMembership({ roles: ['owner', 'admin'] })

// Anywhere:
if (hasOrgRole('owner')) { ... }
```

`requireMembership` throws `AuthenticationError` with no current user and
`ForbiddenError` with no current organization or a role mismatch — the same
error types `requireAuth` uses.

## Web

`@cedarjs/tenancy/web` exports `OrgScope`, `useCurrentOrg`, `OrgContext` and
`getMemberships`/`hasOrgRole` for the client side: a per-organization Apollo
client provided under organization routes, keyed by the immutable organization
id so switching organizations never mixes caches. See the how-to for the full
`<Set wrap={OrgScope}>` setup `yarn cedar setup tenancy` generates.
