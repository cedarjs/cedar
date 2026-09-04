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

| Flag                    | Default          | Description                                                         |
| ----------------------- | ---------------- | ------------------------------------------------------------------- |
| `--tenant-field <name>` | `organizationId` | The column name the Prisma extension scopes tenant-owned models on. |
| `--force`               | off              | Overwrite generated files that already exist.                       |

Requires a `User` model in `api/db/schema.prisma` (set up auth first) and aborts
if `Organization` or `Membership` are already defined. It also adds the
`RW_DataMigration` model (the one `yarn cedar data-migrate install` adds) if it
isn't already there, since the generated data migration and the setup output's
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
checks that every create (nested ones included) targets the current
organization and refuses cross-tenant writes. For tenant-owned models, reads,
updates and deletes are scoped automatically and throw `TenantScopeError`
when no organization is in scope.

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

From `@cedarjs/tenancy` (re-exported from `api/src/lib/auth.ts` by the setup
command):

```ts
export function hasOrgRole(
  roles: string | string[],
  organizationId?: string
): boolean
export function requireMembership(options?: { roles?: string | string[] }): void
```

`hasOrgRole(roles, organizationId?)`: with an `organizationId`, checks
`context.currentUser.memberships` for a matching role; without one, checks
`context.currentOrg.role`. Returns `false` when unauthenticated, when there's no
matching organization, or when `context.currentOrg` is unset. An empty `roles`
array returns `true` as long as a membership exists.

`requireMembership(options?)`: throws `AuthenticationError` when there's no
`context.currentUser`, `ForbiddenError` when there's no `context.currentOrg` or
its role doesn't match `options.roles`. These are the same error types
`requireAuth()` throws.

## The `@requireMembership` directive

Generated by `setup tenancy` at
`api/src/directives/requireMembership/requireMembership.ts` (app-owned, like
`@requireAuth`):

```graphql
directive @requireMembership(roles: [String]) on FIELD_DEFINITION
```

Built with `createValidatorDirective` from `@cedarjs/graphql-server`, calling
`requireMembership({ roles })` from `src/lib/auth`.

## Web API

From `@cedarjs/tenancy/web`:

```ts
export interface OrgMembership {
  id: string
  organizationId: string
  role: string
  organization: { id: string; slug: string; name: string }
}

export interface CurrentOrgSummary {
  id: string
  slug: string
  name: string
  role: string
  membershipId: string
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

`orgSlug` resolves from `useParams().orgSlug` by default; pass the `orgSlug`
prop to source it from state instead (an organization switcher that isn't
URL-driven, for example). `memberships` come from
`getMemberships(useAuth().currentUser)`. Internally, `OrgScope` builds (or
reuses) a per-organization Apollo client keyed by `${userId}:${organizationId}`
and renders:

```tsx
<ApolloProvider client={client}>
  <OrgContext.Provider value={...}>{children}</OrgContext.Provider>
</ApolloProvider>
```

Client teardown: when `useAuth().isAuthenticated` becomes `false`, or
`currentUser.id` changes, every cached client is dropped after `clearStore()`.
When a memberships refresh shows a membership gone or its role changed, that
organization's client alone is dropped the same way.

### `useCurrentOrg()`

Reads `OrgContext`. `setOrg(idOrSlug)` navigates to the current route with a new
`orgSlug` param (using `navigate` and `routes` from `@cedarjs/router`) by
default; when `OrgScope` is given an `onSetOrg` prop, `setOrg` calls that
instead.

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
