# Multi-Tenancy

`@cedarjs/tenancy` adds organizations, memberships, per-organization roles and
tenant-scoped database access to a Cedar app: one user account can belong to
several organizations, each membership carries its own role, and every read and
write on a tenant-owned model is scoped to the current organization
automatically. Code that runs with no organization in scope fails loudly instead
of leaking data across tenants.

For the model, the reasoning behind it, and worked examples (jobs, agencies,
RLS), see the [Multi-Tenancy how-to](how-to/multi-tenancy.md). This page is the
API reference.

## Install

```shell
yarn cedar setup tenancy
```

| Flag                    | Default          | Description                                                                    |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `--tenant-field <name>` | `organizationId` | The column name the Prisma extension scopes tenant-owned models on.            |
| `--force`               | off              | Overwrite generated files that already exist, and see below for schema.prisma. |

Requires a `User` model in `api/db/schema.prisma` (set up auth first). If
`Organization` or `Membership` already exist there with a shape that differs
from Cedar's, the default (no `--force`) is to leave them untouched, print the
canonical models so you can add the missing fields/relations by hand, and
continue with the rest of the setup. `--force` instead appends Cedar's
versions beside your existing ones and keeps going even though the resulting
schema is invalid Prisma until you merge them &mdash; the "Next steps" output
says so explicitly. Either way, `setup
tenancy` also adds the `RW_DataMigration` model (the one
`yarn cedar data-migrate install` adds) if it isn't already there, since the
generated data migration and the setup output's
`data-migrate up` step both need it. See
[What `setup tenancy` changes](how-to/multi-tenancy.md#what-setup-tenancy-changes)
in the how-to for the full list of generated and modified files.

## The Prisma extension

```ts
import { createTenancyExtension } from '@cedarjs/tenancy'

export const db = prismaClient.$extends(
  createTenancyExtension<typeof prismaClient>({
    models: { allExcept: ['user', 'organization', 'membership'] },
  })
)
```

### `TenancyConfig`

| Option        | Type                                                                  | Default                        | Description                                                                     |
| ------------- | --------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `tenantField` | `string`                                                              | `'organizationId'`             | The column name on tenant-owned models.                                         |
| `models`      | `ModelNamesFor<TClient>[] \| { allExcept: ModelNamesFor<TClient>[] }` | required                       | An explicit list of tenant-owned models, or every model except the ones listed. |
| `getTenantId` | `() => string \| undefined`                                           | reads `context.currentOrg?.id` | Where the extension gets the current tenant id from.                            |

`ModelNamesFor<TClient>` is every key on the Prisma client that isn't a
`$`-prefixed method &mdash; the client's camelCase accessor names (`project`,
not `Project`).

The `allExcept` form is the default the setup command generates, because it
fails closed: a new model added later is scoped automatically, and forgetting to
list it as an exception is the error, not the silent gap. This also applies
immediately to every model that already existed before `setup tenancy` ran: each
one is tenant-owned as soon as setup finishes, so its queries throw
`TenantScopeError` until you either give it `organizationId String` plus
`@@index([organizationId])`, or add it to `allExcept` because it's meant to stay
global.

### Behavior

**Creates are explicit and verified; reads, updates and deletes are ambient
and fail closed.** Prisma's generated types still require the tenant field on
creates, so you should keep writing it. On a scoped client, the extension
checks that every create of a tenant-owned model (nested ones included)
targets the current organization and refuses cross-tenant writes. Reads,
updates and deletes on tenant-owned models are scoped automatically and throw
`TenantScopeError` when no organization is in scope.

Every operation keeps its own method; the extension only adds a `tenantField`
equality to the arguments.

| Operation                                                                                                                       | Injection                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `findUnique`, `findUniqueOrThrow`, `update`, `delete`, `upsert`                                                                 | `where[tenantField] = tenantId` beside the unique field                                                                         |
| `findFirst`, `findFirstOrThrow`, `findMany`, `count`, `aggregate`, `groupBy`, `updateMany`, `updateManyAndReturn`, `deleteMany` | `where[tenantField] = tenantId` merged with `AND`                                                                               |
| `create`, `createMany`, `createManyAndReturn`, `upsert.create`                                                                  | `data[tenantField] = tenantId` on every row (`data` may be a single object or an array); throws if a row sets a different value |
| `update`, `updateMany`, `updateManyAndReturn`, `upsert.update`                                                                  | `data[tenantField]` rejected unless it equals `tenantId`; a row can never move to another organization                          |
| Nested `create`/`createMany`/`update`/`updateMany`/`upsert` under a tenant-owned relation                                       | Same `data` rules, recursively                                                                                                  |
| Nested `connect`/`connectOrCreate`/`disconnect`/`set`/`delete`/`deleteMany` targeting a tenant-owned model                      | `tenantField` added to the `where` (`{ id, organizationId }`); `connectOrCreate.create` gets `data` injection                   |
| Nested list `include`/`select`/`_count.select` of a tenant-owned relation, reached from any model (including global ones)       | `where[tenantField] = tenantId` merged into the relation arguments                                                              |
| `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe` on a scoped client                                           | Throws `TenantScopeError`; raw SQL is only available on `db.$withoutTenant()`                                                   |

A tenant-owned model queried with no tenant id in scope (no
`context.currentOrg`, no `$forOrg`, no `$withoutTenant`) throws
`TenantScopeError` naming the model and pointing at `db.$forOrg(id)` /
`db.$withoutTenant()`.

Global models (anything not listed as tenant-owned) are never restricted
directly, but their nested tenant-owned relations are still scoped by the
"nested list" row above.

### Escape hatches

```ts
db.$forOrg(organizationId) // a client scoped to that org, ignoring context
db.$withoutTenant() // an unscoped client, no injection, no throwing
```

Both return new clients from `$extends` sharing the same underlying engine and
connection pool as the base client &mdash; creating one per job or per request
costs nothing measurable, but create it once per unit of work rather than per
query in a loop, since each `$extends` call produces a large derived TypeScript
type.

`db.$forOrg(orgId)` has the same type as `db`, so a helper that works with
either can take a `typeof db` parameter. `db.$withoutTenant()` has `db`'s
models and `$transaction` and differs only in allowing raw SQL; its type is
`UnscopedClient<typeof db, typeof prismaClient>` from `@cedarjs/tenancy`. Both
clients have `$forOrg` and `$withoutTenant` too.

| Situation                                                                    | Helper                                    | Why the default scope doesn't apply                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Background job (`@cedarjs/jobs`), cron, `cedar exec` script                  | `db.$forOrg(orgId)`                       | No request, so no `currentOrg`; the job receives `organizationId` as an argument |
| Seed script, data migration, admin dashboard, cross-tenant reporting         | `db.$withoutTenant()`                     | Intentionally not scoped to one organization                                     |
| Webhook or inbound-email handler that identifies the tenant from the payload | `db.$forOrg(orgId)`                       | The tenant is known but isn't in the auth context                                |
| Public page reading one organization's data for an unauthenticated visitor   | `db.$forOrg(orgId)`                       | No user, so `setCurrentOrg` refuses to set a `currentOrg`                        |
| One request that must touch two organizations                                | `db.$forOrg(otherId)` for the second side | Context holds one organization at a time                                         |

### Caveats

- `$on` must be attached to the base client before `$extends`. The `db.ts`
  template and the setup codemod keep that order.
- Apply the tenancy extension last, after any other `$extends`. The
  `$forOrg`/`$withoutTenant` clients are built from the client the tenancy
  extension extends, so an extension added after it isn't on them, though
  their type says it is. The setup codemod adds it last.
- Query extensions run inside interactive transactions, so
  `db.$transaction(async (tx) => tx.project.create(...))` stays scoped.
  `$forOrg`/`$withoutTenant` clients have their own `$transaction`; don't mix a
  `tx` from one client with queries on another.
- `db.$withoutTenant()` disables the only check that turns a missing
  `organizationId` into an error. Code using it is responsible for every `where`
  and `data` it writes, which is why seeds and admin code are the intended
  callers and services are not.
- The extension targets Prisma 7 client extensions (`$extends`). It relies on
  the `prisma-client` generator's `_runtimeDataModel` to discover relations to
  tenant-owned models; it does not read `Prisma.dmmf`.

## Context helpers

From `@cedarjs/tenancy`:

```ts
export interface CurrentOrg {
  id: string
  slug: string
  role: string
  membershipId: string
}

export function setCurrentOrg(
  org: { id: string; slug: string },
  currentUser: UserWithMemberships
): CurrentOrg

export function getCurrentOrg(): CurrentOrg | undefined

export function requireCurrentOrg(): CurrentOrg

export function resolveCurrentOrg(args: {
  event: APIGatewayProxyEvent | Request
  variables?: Record<string, unknown>
  currentUser: UserWithMemberships
  lookupOrg: (idOrSlug: string) => Promise<{ id: string; slug: string } | null>
}): Promise<CurrentOrg | undefined>

export function withTenancy<Event, Ctx, Result>(
  handler: (event: Event, context: Ctx) => Promise<Result> | Result,
  options: {
    authDecoder: Decoder | Decoder[]
    getCurrentUser: (decoded, raw, req) => Promise<unknown>
    lookupOrg: (
      idOrSlug: string
    ) => Promise<{ id: string; slug: string } | null>
  }
): (event: Event, context: Ctx) => Promise<Result>
```

### `setCurrentOrg(org, currentUser)`

Takes only the organization's identity (`id`, `slug`); `role` and `membershipId`
are always derived from `currentUser.memberships`, never taken from the caller,
so nothing that calls `setCurrentOrg` can grant a role that isn't backed by a
real membership. Throws `ForbiddenError` (from `@cedarjs/graphql-server`) when
`currentUser` has no membership with a matching `organizationId`. Writes
`context.currentOrg` (via `@cedarjs/context`) and returns it.

### `getCurrentOrg()`

Reads `context.currentOrg`. Returns `undefined` when nothing has been resolved
for this request &mdash; no throwing.

### `requireCurrentOrg()`

Reads `context.currentOrg` and throws `TenantScopeError` if it's unset. Use this
in a service or directive that needs to fail loudly rather than branch on
`undefined`.

### `resolveCurrentOrg(args)`

Resolves the organization identity for the current request and calls
`setCurrentOrg` with it. Resolution order:

1. The `cedar-org` request header (read with `getEventHeader` from
   `@cedarjs/api`).
2. `variables.orgId`, when `variables` is provided and the header is absent.
3. `variables.orgSlug`, when both of the above are absent.
4. `undefined` &mdash; no organization in scope, nothing set, no error.

Whichever identifier is found is passed to `lookupOrg(idOrSlug)`. A `null`
result (no such organization) throws `ForbiddenError`, the same as a non-member,
so the response never reveals whether an organization with that id or slug
exists.

### `withTenancy(handler, options)`

For plain `api/src/functions/*` handlers, which don't go through the GraphQL
context function. Runs `getAuthenticationContext` (from `@cedarjs/api`) with
`options.authDecoder`, then `options.getCurrentUser`, then `resolveCurrentOrg`
using the request's headers and `options.lookupOrg`, then calls `handler` inside
a context store (`getAsyncStoreInstance().run(...)` from
`@cedarjs/context/dist/store`) with `currentUser` and `currentOrg` set.

```ts title="api/src/functions/exportReport.ts"
import { withTenancy } from '@cedarjs/tenancy'
import { authDecoder, getCurrentUser } from 'src/lib/auth'
import { db } from 'src/lib/db'

const lookupOrg = async (idOrSlug: string) =>
  (await db.organization.findUnique({
    where: { id: idOrSlug },
    select: { id: true, slug: true },
  })) ??
  db.organization.findUnique({
    where: { slug: idOrSlug },
    select: { id: true, slug: true },
  })

export const handler = withTenancy(
  async (event, context) => {
    const projects = await db.project.findMany()
    return { statusCode: 200, body: JSON.stringify(projects) }
  },
  { authDecoder, getCurrentUser, lookupOrg }
)
```

### `withTenancy` as a plain function

`withTenancy` doesn't have to wrap a Lambda-shaped handler. Anything that
returns a value from inside the context it establishes works, which is useful
for a `cedar exec` script or worker entry point that still wants request-shaped
org resolution rather than `$withoutTenant`/`$forOrg`:

```ts title="scripts/exportOrgReport.ts"
import { withTenancy } from '@cedarjs/tenancy'
import { authDecoder, getCurrentUser } from 'api/src/lib/auth'
import { db } from 'api/src/lib/db'

const lookupOrg = async (idOrSlug: string) =>
  (await db.organization.findUnique({
    where: { id: idOrSlug },
    select: { id: true, slug: true },
  })) ??
  db.organization.findUnique({
    where: { slug: idOrSlug },
    select: { id: true, slug: true },
  })

const run = withTenancy(
  async (event) => {
    // db.project.findMany() here is scoped to context.currentOrg,
    // resolved from `event`'s headers by withTenancy
    return db.project.findMany()
  },
  { authDecoder, getCurrentUser, lookupOrg }
)

export default async () => {
  const fakeEvent = { headers: { 'cedar-org': process.argv[2] } }
  const projects = await run(fakeEvent, {})
  console.log(projects)
}
```

### `GlobalContext` augmentation

`@cedarjs/tenancy` declares `currentOrg?: CurrentOrg` on `@cedarjs/context`'s
`GlobalContext` via declaration merging, so `context.currentOrg` is typed
anywhere `@cedarjs/context` is imported once the package is installed.

## Auth helpers

From `@cedarjs/tenancy`:

```ts
export function createTenancyAuth(): {
  hasUserRole(roles: string | readonly string[]): boolean
  hasOrgRole(
    roles?: string | readonly string[],
    organizationId?: string
  ): boolean
  requireUserAuth(options?: { roles?: string | readonly string[] }): void
  requireOrgAuth(options?: { roles?: string | readonly string[] }): void
}

export function hasOrgRole(
  roles: string | readonly string[],
  organizationId?: string
): boolean
```

### `createTenancyAuth()`

The setup command replaces the single-tenant `hasRole` and `requireAuth` in
`api/src/lib/auth.ts` with these:

```ts title="api/src/lib/auth.ts"
export const { hasUserRole, hasOrgRole, requireUserAuth, requireOrgAuth } =
  createTenancyAuth()
```

There's no `hasRole` or `requireAuth`: each check says what it's about.

|                             | User-level (`currentUser.roles`)                     | Organization-level (membership role)                  |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| api (`createTenancyAuth()`) | `hasUserRole`, `requireUserAuth`, `@requireUserAuth` | `hasOrgRole`, `requireOrgAuth`, `@requireOrgAuth`     |
| web                         | `useAuth().hasUserRole`                              | `useCurrentOrg().hasOrgRole`, `<PrivateSet orgRoles>` |

- `requireOrgAuth({ roles })`: for fields about the current organization.
  Throws `AuthenticationError` when no one is signed in, and `ForbiddenError`
  when there's no `context.currentOrg`, or when `roles` are given and the
  user's role in it isn't one of them. With no `roles`, any member gets in,
  just as any signed-in user gets past a bare single-tenant `@requireAuth`:
  a role you add later can use every field that lists no roles. For anything
  narrower, list `roles` or use [`@requirePermission`](#permissions), which
  gives a new role only what its permission list says.
- `requireUserAuth({ roles })`: for fields about the signed-in user rather
  than an organization (their account, their memberships, accepting an
  invitation). Throws `AuthenticationError` when no one is signed in, and,
  when `roles` are given, `ForbiddenError` unless `currentUser.roles` has one
  of them. No organization is needed. It checks what the single-tenant
  `requireAuth` did.

`hasUserRole(roles)` checks `currentUser.roles`, as the single-tenant
`hasRole` did. `hasOrgRole(roles?, organizationId?)` is the standalone
`hasOrgRole` below: with no roles, it's whether the user is a member. Setup
renames `hasRole` and `requireAuth` imported from `api/src/lib/auth` to
`hasUserRole` and `requireUserAuth`, and `hasRole` from `useAuth()` in
`web/src` to `hasUserRole`.

With tenancy, a role belongs to a membership, so don't copy one into
`currentUser.roles` in `getCurrentUser`: a user who is `owner` in one
organization and has a narrower role in another would carry `owner` into every
check made outside an organization. Leave `roles` off `currentUser`, or use it
only for roles that really hold everywhere.

### `hasOrgRole(roles, organizationId?)`

With an `organizationId`, checks `context.currentUser.memberships` for a
matching role; without one, checks `context.currentOrg.role`. Returns `false`
when unauthenticated, when there's no matching organization, or when
`context.currentOrg` is unset. An empty `roles` array returns `true` as long as
a membership exists. Use it for an organization other than the current one;
for the current one, `requireOrgAuth` already checks it.

## The `@requireOrgAuth` and `@requireUserAuth` directives

`setup tenancy` replaces the app's `@requireAuth` directive with two, in
`api/src/directives/requireOrgAuth/` and `api/src/directives/requireUserAuth/`,
which pass their `roles` on to `requireOrgAuth()` and `requireUserAuth()`:

```graphql
type Query {
  projects: [Project!]! @requireOrgAuth
  inviteMember(input: InviteMemberInput!): Invitation!
    @requireOrgAuth(roles: ["owner", "admin"])
  myMemberships: [Membership!]! @requireUserAuth
}
```

Before tenancy there are no organizations, so every field the app already has
is about the user: setup renames each `@requireAuth` to `@requireUserAuth`,
and each `requireAuth` imported from `api/src/lib/auth` to `requireUserAuth`.
They check what they did before. It deletes
`api/src/directives/requireAuth/` when it's the one Cedar generates. A changed
one is left, and so are its `@requireAuth` fields, so its checks keep running
until you move them to `@requireUserAuth` or `@requireOrgAuth`.

When a model gets an `organizationId`, switch its fields to
`@requireOrgAuth`. From then on `cedar generate sdl` and `cedar generate
scaffold` pick the directive for you: `@requireOrgAuth` for a model with an
`organizationId` (or the field you gave `--tenant-field`) or an
`Organization` relation, `@requireUserAuth` for one without. Once
`api/src/directives/requireAuth/` is gone, writing `@requireAuth` in a tenancy
app is an unknown directive, so it fails when the schema is built rather than
when the field is first called.

## Permissions

Roles map to permissions in one place, and fields ask for a permission instead
of listing roles. Adding a role is then one entry in the definitions instead of an edit
to every field it should reach, and the web reads the same answers instead of
repeating role lists.

### The definitions

`setup tenancy` generates `packages/permissions`, a package that both sides
share: the api checks the permissions, and the web can import their names. It
turns on `experimental.packagesWorkspace` in `cedar.toml` for it, and names the
package in the scope your other packages use (`@my-org/permissions`), or after
your app's folder when there are none.

```ts title="packages/permissions/src/index.ts"
import { definePermissions } from '@cedarjs/tenancy/permissions'
import type { PermissionName } from '@cedarjs/tenancy/permissions'

export const permissions = definePermissions({
  permissions: ['organization.read', 'members.manage'],
  roles: {
    owner: ['organization.read', 'members.manage'],
    admin: ['organization.read', 'members.manage'],
    member: ['organization.read'],
  },
})

export type Permission = PermissionName<typeof permissions>
```

- `permissions`: every permission the app checks, by name. Fields, services
  and the web ask for these names, so they're defined in code. A name is a
  stable id, so it can also key what the app shows for it, such as a
  translated label.
- `roles`: what each built-in role may do in an organization. A permission
  listed here needs a current organization, and the user's role there must
  have it. A role that isn't listed has no permissions.

Every permission is about an organization. Fields about the user rather than
an organization use `@requireUserAuth`.

A role listing a name that `permissions` doesn't define is a type
error, and `definePermissions` throws for it at runtime too.
`@cedarjs/tenancy/permissions` has no api code in it, so the web can import
the package.

### Checking permissions on the api

```ts title="api/src/lib/permissions.ts"
import { createPermissions } from '@cedarjs/tenancy'

import { permissions } from '@my-app/permissions'

export const {
  hasPermission,
  requirePermission,
  permissionsOf,
  withPermissions,
} = createPermissions(permissions)
```

From `@cedarjs/tenancy`:

```ts
export function createPermissions(definitions: PermissionDefinitions): {
  hasPermission(permission: Permission): boolean
  requirePermission(options: { permission: Permission }): void
  permissionsOf(membership: { role: string }): Permission[]
  withPermissions<User extends { memberships: { role: string }[] }>(
    user: User | null
  ): (User & { memberships: { permissions: Permission[] }[] }) | null
}
```

`Permission` is the union of the defined names, so a typo in a service is a
type error.

`hasPermission(permission)` answers for the current request.
`requirePermission()` throws `AuthenticationError` when no one is signed in and
`ForbiddenError` when `hasPermission()` is false, with a message saying an
organization is needed when that's why. Both throw a plain `Error` for a name
that isn't defined, so a typo in an SDL directive (which TypeScript can't see)
is a loud error rather than a field nobody can use.

`permissionsOf(membership)` is the one place a membership's permissions are
worked out: its role's. `hasPermission`,
`requirePermission` and `withPermissions` all use it, and `hasPermission`
passes it the membership as `getCurrentUser` returned it.

Permissions fail closed by construction: a field asks for one permission, and
only the roles that list it get in. A new role starts with nothing.

### `@requirePermission`

Generated at `api/src/directives/requirePermission/requirePermission.ts`:

```graphql
directive @requirePermission(permission: String!) on FIELD_DEFINITION
```

```graphql
type Mutation {
  inviteMember(input: InviteMemberInput!): Invitation!
    @requirePermission(permission: "members.manage")
}
```

It sits beside `@requireOrgAuth`. Use whichever reads better per field; the
generated organizations SDL uses `@requirePermission` for organization fields
and `@requireUserAuth` for user-level ones.

`yarn cedar lint` checks the permission names in the SDL against the ones
`definePermissions` lists, so an unknown name is caught before it throws at
runtime.

### Permissions on the web

`withPermissions(user)` adds each membership's permissions (its role's) to the
user `getCurrentUser` returns. `setup tenancy` wraps the
lookup in it:

```ts title="api/src/lib/auth.ts"
return withPermissions(
  await db.user.findUnique({ where: { id: session.id }, select: { ... } })
)
```

So `currentUser.memberships[n].permissions` reaches the web with the rest of
the memberships, and the web checks those rather than working them out from a
role.
Like roles, it's a snapshot refreshed by `reauthenticate()`.

## Web API

From `@cedarjs/tenancy/web`:

```ts
export interface OrgMembership {
  id: string
  organizationId: string
  role: string
  /** Added by `withPermissions`; missing when the app doesn't use it */
  permissions?: string[]
  organization: { id: string; slug: string; name: string }
}

export interface CurrentOrgSummary {
  id: string
  slug: string
  name: string
  role: string
  membershipId: string
  permissions: string[]
}

export function hasOrgRole(
  memberships: OrgMembership[] | undefined,
  roles: string | string[],
  organizationId: string
): boolean

export function getMemberships(currentUser: unknown): OrgMembership[]

export interface CreateTenancyOptions {
  /**
   * Finds the organization of a route. By default, the one with the route's
   * `orgSlug` param. Returns what `useOrgBySlug` does: full memberships from
   * `currentUser.memberships`.
   */
  useOrg?: UseTenancyOrg
  /** Rendered for a signed-in user who isn't a member of the organization. Default: null. */
  notAMember?: React.ReactNode
  /** Called by `useCurrentOrg().setOrg` instead of navigating. */
  onSetOrg?: (idOrSlug: string) => void
}

/** For `<Router tenancy>` */
export function createTenancy(options?: CreateTenancyOptions): Tenancy

/** `createTenancy()`, for an app that needs no options */
export const tenancy: Tenancy

/** The organization with this slug in the user's memberships, for a `useOrg` */
export function useOrgBySlug(
  useAuth: UseAuth,
  orgSlug: string | undefined
): { membership: OrgMembership | null; memberships: OrgMembership[] } | null

export function useCurrentOrg(): {
  org: CurrentOrgSummary | undefined
  memberships: OrgMembership[]
  hasOrgRole(roles: string | string[], organizationId?: string): boolean
  setOrg(idOrSlug: string): void
}

export function clearOrgClients(): Promise<void>
```

### `tenancy` on the Router

The `Router` renders the organization for you. Pass it the `tenancy` from
`createTenancy`, next to `useAuth`, and put the organization's routes in a
`PrivateSet`:

<!-- prettier-ignore -->
```tsx title="web/src/Routes.tsx"
import { tenancy } from 'src/tenancy'

<Router useAuth={useAuth} tenancy={tenancy}>
  <Route path="/login" page={LoginPage} name="login" />
  <PrivateSet wrap={OrgLayout} unauthenticated="login">
    <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
  </PrivateSet>
</Router>
```

```ts title="web/src/tenancy.tsx"
import { createTenancy } from '@cedarjs/tenancy/web'

export const tenancy = createTenancy({
  notAMember: <p>You don't have access to this organization.</p>,
})
```

`yarn cedar setup tenancy` generates `web/src/tenancy.tsx` and passes it to your
`Router`. It's the one place to customize how the router handles organizations
(see [An organization from the host](#an-organization-from-the-host)). Create
it once, at the top level of a module: a new tenancy on every render would
remount the provider.

For a `PrivateSet` whose route is in an organization (by default, one with
`{orgSlug}` in its path), the router renders the organization's provider around
the set's `wrap` and the page, so a layout like `OrgLayout` can use
`useCurrentOrg()`. A user who isn't signed in is sent to `unauthenticated`
first, and one who isn't a member of the organization sees `notAMember` instead
of the layout and the page.

The organization is found from `currentUser.memberships`: the one whose slug is
in the route's `orgSlug` param. The provider gives everything below it:

- a per-organization Apollo client (built or reused, keyed by
  `${userId}:${organizationId}`) that sends the organization in the `cedar-org`
  header, so every Cell, `useQuery` and `useMutation` under it reads from that
  organization's cache,
- the organization for `useCurrentOrg()`,
- a `useAuth().hasPermission` that checks the user's membership in that
  organization.

There's one provider per organization, however many `PrivateSet`s are nested
inside each other, and it stays mounted while the user moves between the
organization's pages. Going to another organization's page mounts a new one.

A route that has `{orgSlug}` in its path but isn't in a `PrivateSet` is a
public page with no organization context: no provider, so no `useCurrentOrg()`
and no `cedar-org` header on its queries (see
[Prerendering](#prerendering-organization-pages)). A `PrivateSet` whose routes
have no `{orgSlug}`, such as `/dashboard`, is an ordinary private set.

On the web too, every role check names its kind: `useAuth().hasUserRole` and
`<PrivateSet userRoles>` check `currentUser.roles`, and
`useCurrentOrg().hasOrgRole` and `<PrivateSet orgRoles>` check the user's role
in the organization. `useAuth().hasRole` and `<PrivateSet roles>` aren't
available with tenancy: `cedar generate types` marks the app as having tenancy
(`.cedar/types/includes/web-tenancy.d.ts`), and then using either is a type
error. For the same reason `tenancy` on the `Router`, `orgRoles` and
`orgPermission` only exist in an app with tenancy.

Client teardown: when `useAuth().isAuthenticated` becomes `false`, or
`currentUser.id` changes, every cached client is dropped after `clearStore()`.
When a memberships refresh shows a membership gone, that organization's client
alone is dropped the same way, and one cached for another role is replaced.

#### Guarding routes by role and permission

To let only some members open a page, give its `PrivateSet` `orgRoles` or
`orgPermission`, and `unauthorized`:

<!-- prettier-ignore -->
```tsx title="web/src/Routes.tsx"
<Router useAuth={useAuth} tenancy={tenancy}>
  <PrivateSet wrap={OrgLayout} unauthenticated="login">
    <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
  </PrivateSet>
  <PrivateSet wrap={OrgLayout} unauthenticated="login" unauthorized="projects" orgRoles="owner">
    <Route path="/org/{orgSlug}/settings" page={SettingsPage} name="settings" />
  </PrivateSet>
  <PrivateSet wrap={OrgLayout} unauthenticated="login" unauthorized="projects" orgPermission="members.manage">
    <Route path="/org/{orgSlug}/members" page={MembersPage} name="members" />
  </PrivateSet>
</Router>
```

The router checks the membership it found for the organization: `orgRoles`
against its role, and `orgPermission` against its
[permissions](#permissions-on-the-web), the same ones `useAuth().hasPermission`
checks. A member without one of `orgRoles`, or without the permission, is
redirected to the `unauthorized` route, which gets the `orgSlug` of the page
they tried to open when its path has an `{orgSlug}`. With no `unauthorized`,
they're redirected to `unauthenticated`. Neither the provider nor the rest of
the set's `wrap` renders for them. A user who isn't a member of the
organization at all sees `notAMember` rather than being redirected.

A `PrivateSet` inside another one in the same organization checks its own
`orgRoles` and `orgPermission` and renders no second provider.

A `PrivateSet` with `orgRoles` or `orgPermission` throws an error rather than
let anyone in when the router has no `tenancy`, or when there's no organization
to check in: with Cedar's `tenancy`, a route with no `{orgSlug}` param.

`userRoles` checks `currentUser.roles` the same way. Given more than one of
them, a user needs all. As with every check on the web, this only decides what
to show: the api's `@requireOrgAuth` and `@requirePermission` are what protect
the data.

#### An organization from the host

By default the organization is the one in the route's `orgSlug` param. For an
organization that doesn't come from the path, such as one taken from a
subdomain (`acme.example.com`), give `createTenancy` a `useOrg` that finds it.
`useOrgBySlug` keeps Cedar's membership lookup. This one place covers the
router's `orgRoles` and `orgPermission` checks, the provider and
`useCurrentOrg()`:

<!-- prettier-ignore -->
```tsx title="web/src/tenancy.tsx"
import { createTenancy, useOrgBySlug } from '@cedarjs/tenancy/web'

// There's no `window` when prerendering
const slugFromHost = () => (typeof window === 'undefined' ? undefined : window.location.hostname.split('.')[0])

export const tenancy = createTenancy({
  useOrg: (useAuth) => useOrgBySlug(useAuth, slugFromHost()),
  notAMember: <p>You don't have access to this organization.</p>,
})
```

<!-- prettier-ignore -->
```tsx title="web/src/Routes.tsx"
const Routes = () => (
  <Router useAuth={useAuth} tenancy={tenancy}>
    <Route path="/login" page={LoginPage} name="login" />
    <PrivateSet wrap={OrgLayout} unauthenticated="login">
      <Route path="/projects" page={ProjectsPage} name="projects" />
    </PrivateSet>
    <PrivateSet wrap={OrgLayout} unauthenticated="login" unauthorized="projects" orgRoles="owner">
      <Route path="/settings" page={SettingsPage} name="settings" />
    </PrivateSet>
  </Router>
)
```

Your `useOrg` is a hook the router calls on every render of a private set, with
the router's `useAuth` and the route's path params. It can answer in three ways:

- An organization: `{ membership, memberships }`, where `membership` is `null`
  when the user isn't a member of it. `useOrgBySlug` returns that.
- `null`, for no organization. A `PrivateSet` with `orgRoles` or
  `orgPermission` then throws the router's own error, and any other
  `PrivateSet` is an ordinary private one.
- An error of its own, such as for an organization that's been suspended. It
  reaches your app's error boundary like any error thrown while rendering.

With no `{orgSlug}` in the path, `setOrg` can't swap a segment of the URL, so
give `createTenancy` an `onSetOrg` too: `useCurrentOrg().setOrg(idOrSlug)` then
calls it instead of navigating.

### Prerendering organization pages

Organization routes prerender like any private route: while prerendering, auth
is loading, so the router renders the set's `whileLoadingAuth` shell and the
provider never mounts. Routes in a set with `prerender` are fine.

A public page about an organization, with `{orgSlug}` in a plain `Set`,
prerenders like any other dynamic route. Return the slugs from a
[route hook](./prerender.md#dynamic-routes--route-hooks), use `@skipAuth` on
the fields the page reads, and have the page query the organization by the slug
from `useParams()`: the page has no provider, so its queries carry no
`cedar-org` header.

```ts title="web/src/pages/OrgPublicPage/OrgPublicPage.routeHooks.ts"
import { db } from '$api/src/lib/db'

export async function routeParameters() {
  const organizations = await db.organization.findMany()

  return organizations.map(({ slug }) => ({ orgSlug: slug }))
}
```

### `useCurrentOrg()`

Reads the organization the router resolved for the current route. It works in
the layouts and pages of a `PrivateSet` whose route is in an organization, and
throws anywhere else. `setOrg(idOrSlug)` navigates to the current route with a
new `orgSlug` param (using `navigate` and `routes` from `@cedarjs/router`) by
default; when `createTenancy` is given an `onSetOrg` option, `setOrg` calls that
instead.

### `useAuth().hasPermission(permission)`

Under an organization route, `useAuth().hasPermission(permission)` checks the
`permissions` that `withPermissions` added to the user's membership in that
organization. Outside one it's `false`, so a check in the wrong place hides
rather than shows. The organization's provider supplies it through
`HasPermissionContext` from `@cedarjs/auth`.

```tsx
const MembersPage = () => {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('members.manage')

  return <MemberList editable={canManage} />
}
```

`hasPermission` only takes the names in `packages/permissions`, so a typo is a
type error: `cedar generate types` writes them to
`.cedar/types/includes/all-permissions.d.ts`, which fills in
`AvailablePermissions` from `@cedarjs/auth`. In an app without permissions (no
`packages/permissions`, as in a single-tenant app) it takes no names at all, so
calling it is a type error rather than a check that's always `false`.

Like every check on the web, this only decides what to show; the api's
`@requirePermission` is the guard. For a page only some may open, give its
`PrivateSet` an `orgPermission` (see
[Guarding routes by role and permission](#guarding-routes-by-role-and-permission)).

### `hasOrgRole` (web)

The pure form, `hasOrgRole(memberships, roles, organizationId)`, takes the
memberships array explicitly.
`useCurrentOrg().hasOrgRole(roles, organizationId?)` is the convenience wrapper
that reads memberships from context.

### `clearOrgClients()`

Drops every cached per-organization Apollo client. Intended for tests and logout
hooks that want a clean slate outside the normal
`isAuthenticated`/`currentUser.id` teardown path.

### `useCreateApolloClient()`

From `@cedarjs/web/apollo`, added for the organization provider to build its
per-organization client, and usable directly by any code that needs a second Apollo client
sharing the app client's link chain and cache configuration:

```ts
export interface CreateApolloClientOptions {
  headers?: Record<string, string>
}

export function useCreateApolloClient(): (
  options?: CreateApolloClientOptions
) => ApolloClient
```

Must be called under `CedarApolloProvider`; throws otherwise. The returned
factory builds a new `ApolloClient` with a fresh `InMemoryCache` (same
`cacheConfig` and fragment registry as the app client), the same
`defaultOptions`, and the same link chain with an extra link prepended that
merges `options.headers` into `operation.getContext().headers`.

```tsx
import { useCreateApolloClient } from '@cedarjs/web/apollo'

const createClient = useCreateApolloClient()
const orgClient = createClient({ headers: { 'cedar-org': organizationId } })
```

## Request headers

| Header      | Set by                                                | Read by             | Purpose                                                                                                                          |
| ----------- | ----------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `cedar-org` | The per-organization Apollo client the provider gives | `resolveCurrentOrg` | Names the organization id or slug a request targets. No `X-` prefix, per RFC 6648, matching the existing `auth-provider` header. |

It is exported as a constant from `@cedarjs/tenancy`:

```ts
export const CEDAR_ORG_HEADER = 'cedar-org'
```

## Testing

There is no `mockCurrentOrg()` helper yet. To test a service that reads
`context.currentOrg`, set it directly the same way `mockCurrentUser()`-style
context setup works for `context.currentUser`:

```ts title="api/src/services/projects/projects.test.ts"
import { context } from '@cedarjs/context'

scenario('lists only the current organization's projects', async (scenario) => {
  mockCurrentUser({ id: scenario.user.owner.id })

  // highlight-next-line
  context.currentOrg = {
    id: scenario.organization.acme.id,
    slug: 'acme',
    role: 'owner',
    membershipId: scenario.membership.ownerMembership.id,
  }

  const result = await projects()

  expect(result.every((p) => p.organizationId === scenario.organization.acme.id)).toBe(true)
})
```

Unset `context.currentOrg` (or don't set it) to test the `TenantScopeError` /
unauthorized paths.

On the web, the mocked `useAuth` in tests behaves like the real one: inside an
organization route, `hasPermission` checks the membership in that organization, so give
the user from `mockCurrentUser()` the `memberships` your component's
organization needs. Outside one, `hasPermission` is `false`. `hasUserRole`
checks `currentUser.roles`, inside an organization route or not.

## Limitations

- **Row-level only.** Tenant isolation is enforced by the Prisma extension
  checking arguments on every query; it is not database-per-tenant or
  schema-per-tenant isolation. See
  [Postgres RLS as a second layer](how-to/multi-tenancy.md#postgres-row-level-security-as-a-second-layer)
  in the how-to for adding database-level enforcement alongside it.
- **Prisma 7 client extensions only.** The extension is built on `$extends` and
  Prisma 7's `_runtimeDataModel`. Prisma 8 uses a different client with no
  `$extends`; the extension will need reimplementing when a Cedar app moves to
  Prisma 8.
- **Raw SQL only on `db.$withoutTenant()`.** `$queryRaw`, `$executeRaw`,
  `$queryRawUnsafe` and `$executeRawUnsafe` throw `TenantScopeError` on a scoped
  client, on `db.$forOrg(id)`, and on the default `db` outside a request
  context. Call them on `db.$withoutTenant()` and write the tenant filter into
  the SQL yourself.
