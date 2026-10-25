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
export type AuthScope = 'ORGANIZATION' | 'USER'

export function createTenancyAuth(options?: {
  defaultRoles?: readonly string[]
}): {
  hasRole(roles: string | readonly string[]): boolean
  requireAuth(options?: {
    roles?: string | readonly string[]
    scope?: AuthScope
  }): void
  hasOrgRole(
    roles?: string | readonly string[],
    organizationId?: string
  ): boolean
}

export function getCurrentRoles(): string[]

export function hasOrgRole(
  roles: string | readonly string[],
  organizationId?: string
): boolean
```

### `createTenancyAuth(options?)`

The setup command replaces the single-tenant `hasRole` and `requireAuth` in
`api/src/lib/auth.ts` with these:

```ts title="api/src/lib/auth.ts"
export const { hasRole, requireAuth, hasOrgRole } = createTenancyAuth({
  defaultRoles: ['owner', 'admin', 'member'],
})
```

`requireAuth({ roles, scope })` has two scopes:

- `'ORGANIZATION'` (the default): throws `AuthenticationError` when no one is
  signed in, and `ForbiddenError` when there's no `context.currentOrg` or the
  user's role in it isn't one of `roles`. With no `roles` (or an empty list),
  it checks `defaultRoles` instead, and with no `defaultRoles` any membership
  is enough.
- `'USER'`: for fields about the signed-in user rather than an organization
  (their account, their memberships, accepting an invitation). Throws
  `AuthenticationError` when no one is signed in, and, when `roles` are given,
  `ForbiddenError` unless `currentUser.roles` has one of them. No organization
  is needed, and `defaultRoles` don't apply.

The default is the organization because most fields in a multi-tenant app are
about one, and the safe default should be the one you get by not writing
anything: a user-level field that forgets `scope: 'USER'` fails closed (it
needs an organization) instead of open.

`hasRole(roles)` checks `getCurrentRoles()`. `hasOrgRole(roles?,
organizationId?)` is the standalone `hasOrgRole` below, with `defaultRoles`
standing in for missing or empty `roles`.

#### `defaultRoles`

The roles an organization check admits when it lists none. Set it to the roles
that may use everything, and a role you add later (say, a field worker who may
only read one area) is refused by every field that doesn't list it: you opt it
in field by field, and a field added later is closed to it until you do.
Without `defaultRoles`, the new role could use every field that lists no roles,
including the ones written after it.

The setup command sets it to the roles it generates: `owner`, `admin` and
`member` (`ROLE_GRANTS` in `api/src/services/organizations/organizations.ts`).

### `getCurrentRoles()`

The current user's roles for this request: inside an organization (when
`context.currentOrg` is set), their membership's role there; outside one,
`currentUser.roles`. Empty when no one is signed in.

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
for the current one, `requireAuth` and `hasRole` already check it.

## The `@requireAuth` directive

`setup tenancy` adds a `scope` argument to the app's
`api/src/directives/requireAuth/requireAuth.ts`, passed on to `requireAuth()`:

```graphql
directive @requireAuth(
  roles: [String]
  scope: AuthScope = ORGANIZATION
) on FIELD_DEFINITION

enum AuthScope {
  ORGANIZATION
  USER
}
```

```graphql
type Query {
  projects: [Project!]! @requireAuth
  inviteMember(input: InviteMemberInput!): Invitation!
    @requireAuth(roles: ["owner", "admin"])
  myMemberships: [Membership!]! @requireAuth(scope: USER)
}
```

### Upgrading from `@requireMembership`

Canary versions of `@cedarjs/tenancy` had a separate `@requireMembership`
directive and `requireMembership()` function for organization fields, next to
a user-level `@requireAuth`. They're gone. To upgrade an app set up with them:

1. Replace `hasRole` and `requireAuth` in `api/src/lib/auth.ts` with
   `createTenancyAuth` as above, and drop the
   `export { hasOrgRole, requireMembership } from '@cedarjs/tenancy'` line.
2. Add `scope` to `api/src/directives/requireAuth/requireAuth.ts` as above.
3. Add `scope: USER` to every field that has a bare `@requireAuth` or a
   `@requireAuth(roles: [...])` that checks `currentUser.roles`: in a tenancy
   app, those are the user-level fields.
4. Rename `@requireMembership` to `@requireAuth`, and `requireMembership()` to
   `requireAuth()`, then delete `api/src/directives/requireMembership/`.

## Permissions

Roles map to permissions in one place, and fields ask for a permission instead
of listing roles. Adding a role is then one entry in the map instead of an edit
to every field it should reach, and the web reads the same answers instead of
repeating role lists.

From `@cedarjs/tenancy`:

```ts
export function createPermissions(config: {
  roles: Record<string, readonly string[]>
  user?: readonly string[]
}): {
  hasPermission(permission: Permission): boolean
  requirePermission(options: { permission: Permission }): void
  permissionsOf(role: string): Permission[]
  withPermissions<User extends { memberships: { role: string }[] }>(
    user: User | null
  ): (User & { memberships: { permissions: Permission[] }[] }) | null
}
```

`Permission` is the union of every name in the map, so a typo in a service is
a type error.

`setup tenancy` generates the map in `api/src/lib/permissions.ts`:

```ts title="api/src/lib/permissions.ts"
export const {
  hasPermission,
  requirePermission,
  permissionsOf,
  withPermissions,
} = createPermissions({
  roles: {
    owner: ['organization.read', 'members.manage'],
    admin: ['organization.read', 'members.manage'],
    member: ['organization.read'],
  },
  user: [],
})
```

- `roles`: what each role may do in an organization. A permission listed here
  needs a current organization, and the user's role there must have it. A role
  missing from the map has no permissions.
- `user`: what every signed-in user may do, in any organization or none (their
  own account, say). These need no organization.

`hasPermission(permission)` answers for the current request. `requirePermission()`
throws `AuthenticationError` when no one is signed in and `ForbiddenError` when
`hasPermission()` is false, with a message saying an organization is needed when that's
why. Both throw a plain `Error` for a name that isn't in the map, so a typo in
an SDL directive (which TypeScript can't see) is a loud error rather than a
field nobody can use.

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

It sits beside `@requireAuth`. Use whichever reads better per field; the
generated organizations SDL uses `@requirePermission` for organization fields
and `@requireAuth(scope: USER)` for user-level ones.

### Permissions on the web

`withPermissions(user)` adds each membership's permissions (its role's, plus
the `user` ones) to the user `getCurrentUser` returns. `setup tenancy` wraps the
lookup in it:

```ts title="api/src/lib/auth.ts"
return withPermissions(
  await db.user.findUnique({ where: { id: session.id }, select: { ... } })
)
```

So `currentUser.memberships[n].permissions` reaches the web with the rest of
the memberships, and the web can check permissions without a copy of the map.
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
  organizationId: string,
): boolean

export function getMemberships(currentUser: unknown): OrgMembership[]

export interface OrgScopeProps {
  /** Overrides the `orgSlug` route param. */
  orgSlug?: string
  /** Rendered when the user has no membership matching the slug. Default: null. */
  notAMember?: React.ReactNode
  /** Only members with one of these roles in the organization get in. */
  roles?: string | string[]
  /** Only members whose membership has this permission get in. */
  permission?: string
  /** The route a member without one of `roles`, or `permission`, is redirected to. */
  unauthorized?: string
  children: React.ReactNode
}

export function OrgScope(props: OrgScopeProps): JSX.Element

export function useCurrentOrg(): {
  org: CurrentOrgSummary | undefined
  memberships: OrgMembership[]
  hasOrgRole(roles: string | string[], organizationId?: string): boolean
  setOrg(idOrSlug: string): void
}

export const OrgContext: React.Context<...>

export function clearOrgClients(): Promise<void>
```

### `OrgScope`

Used with the router's `Set wrap`:

```tsx title="web/src/Routes.tsx"
<Set wrap={[OrgScope, OrgLayout]}>
  <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
</Set>
```

The generated `web/src/components/OrgScope/OrgScope.tsx` wraps the core
`OrgScope` from `@cedarjs/tenancy/web`, passing your app's `useAuth` (`OrgScope`
can't import your app's auth directly, so it takes `useAuth` as a prop,
defaulting to `useNoAuth` from `@cedarjs/auth`) and a not-a-member message.

`orgSlug` resolves from `useParams().orgSlug` by default as the organization
lives in the URL (see the
[multi-tenancy how-to](./how-to/multi-tenancy.md#4-request-flow-url-to-header-to-context)
for why). Pass the `orgSlug` prop only when it genuinely can't come from the
route: a subdomain- or custom-domain-derived organization, or an in-page
switcher that doesn't navigate. `memberships` come from
`getMemberships(useAuth().currentUser)`. Internally, `OrgScope` builds (or
reuses) a per-organization Apollo client keyed by `${userId}:${organizationId}`
and renders:

```tsx
<ApolloProvider client={client}>
  <OrgContext.Provider value={...}>
    <HasRoleContext.Provider value={hasRoleInThisOrganization}>
      {children}
    </HasRoleContext.Provider>
  </OrgContext.Provider>
</ApolloProvider>
```

So under `OrgScope`, `useAuth().hasRole(roles)` checks the user's role in that
organization rather than `currentUser.roles` (`HasRoleContext` is from
`@cedarjs/auth`). That includes a `<PrivateSet roles>` nested inside the
`OrgScope` set, as the router reads `hasRole` through the same `useAuth`.

Client teardown: when `useAuth().isAuthenticated` becomes `false`, or
`currentUser.id` changes, every cached client is dropped after `clearStore()`.
When a memberships refresh shows a membership gone or its role changed, that
organization's client alone is dropped the same way.

#### Guarding routes by role

A `<PrivateSet roles>` _around_ `OrgScope` is checked before `OrgScope` has
resolved the organization, so it can't see the role there. Give `OrgScope`
`roles` instead, from a small wrapper component (`Set` doesn't pass props on
to `wrap` components):

```tsx title="web/src/Routes.tsx"
const OwnersOnly = ({ children }: { children: React.ReactNode }) => (
  <OrgScope roles="owner" unauthorized="projects">
    {children}
  </OrgScope>
)

// ...

<Set wrap={[OwnersOnly, OrgLayout]}>
  <Route path="/org/{orgSlug}/settings" page={SettingsPage} name="settings" />
</Set>
```

A member without one of `roles` is redirected to the `unauthorized` route,
which gets the organization's `orgSlug` when its path has an `{orgSlug}`. With
no `unauthorized`, they get `notAMember`. As with every check on the web, this
only decides what to show: the api's `@requireAuth` is what protects the data.

`permission` works the same way, against the membership's
[permissions](#permissions-on-the-web):
`<OrgScope permission="members.manage" unauthorized="projects">`.

### `useCurrentOrg()`

Reads `OrgContext`. `setOrg(idOrSlug)` navigates to the current route with a new
`orgSlug` param (using `navigate` and `routes` from `@cedarjs/router`) by
default; when `OrgScope` is given an `onSetOrg` prop, `setOrg` calls that
instead.

### `useAuth().hasPermission(permission)`

Under `OrgScope`, `useAuth().hasPermission(permission)` checks the
`permissions` that `withPermissions` added to the user's membership in that
organization. Outside one it's `false`, so a check in the wrong place hides
rather than shows. `OrgScope` provides it through `HasPermissionContext` from
`@cedarjs/auth`, the same way it provides `hasRole`.

```tsx
const MembersPage = () => {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('members.manage')

  return <MemberList editable={canManage} />
}
```

Like every check on the web, this only decides what to show; the api's
`@requirePermission` is the guard. For a page only some may open, give `OrgScope`
a `permission` (see [Guarding routes by role](#guarding-routes-by-role)).

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

From `@cedarjs/web/apollo`, added for `OrgScope` to build its per-organization
client, and usable directly by any code that needs a second Apollo client
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

| Header      | Set by                                                 | Read by             | Purpose                                                                                                                          |
| ----------- | ------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `cedar-org` | The per-organization Apollo client `OrgScope` provides | `resolveCurrentOrg` | Names the organization id or slug a request targets. No `X-` prefix, per RFC 6648, matching the existing `auth-provider` header. |

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
- **No prerendering under `OrgScope`.** `OrgScope`'s nested `ApolloProvider`
  shadows the per-route client the prerenderer injects above `App`, so a `Route`
  or `Set` inside `<Set wrap={[OrgScope, ...]}>` must not carry the `prerender`
  prop.
- **Raw SQL only on `db.$withoutTenant()`.** `$queryRaw`, `$executeRaw`,
  `$queryRawUnsafe` and `$executeRawUnsafe` throw `TenantScopeError` on a scoped
  client, on `db.$forOrg(id)`, and on the default `db` outside a request
  context. Call them on `db.$withoutTenant()` and write the tenant filter into
  the SQL yourself.
