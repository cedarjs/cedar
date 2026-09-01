# Multi-Tenancy Support ("Linear-style" organizations)

Opt-in, layered multi-tenancy for Cedar apps, modeled on the "Linear" access
pattern from
[The Ultimate Guide to Multi-Tenant SaaS Data Modeling](https://www.ravion.com/blog/ultimate-guide-to-multi-tenant-saas-data-modeling):
one user account can belong to many organizations, each membership carries its
own role, and a user can be active in several organizations at once without
logging out. Tenant scoping is enforced at the Prisma layer so that forgetting
`organizationId` on a query is an error, not a data leak.

## Table of Contents

- [Goals](#goals)
- [Non-Goals](#non-goals)
- [The model](#the-model)
- [Architecture decisions](#architecture-decisions)
- [Layer 1: `@cedarjs/tenancy` runtime](#layer-1-cedarjstenancy-runtime)
- [Layer 2: `yarn cedar setup tenancy`](#layer-2-yarn-cedar-setup-tenancy)
- [Layer 3: generator awareness](#layer-3-generator-awareness)
- [Documentation](#documentation)
- [Testing](#testing)
- [Sequencing](#sequencing)
- [Open questions](#open-questions)
- [References](#references)

## Goals

- A Cedar app can add organizations, memberships, per-organization roles and
  tenant-scoped database access with one setup command and a migration.
- Every database read and write on a tenant-owned model is scoped to the current
  organization automatically. Code that runs with no organization in scope fails
  loudly.
- Role checks per organization work on both sides: `requireMembership()` /
  `hasOrgRole()` in services and directives on the API side, `useCurrentOrg()` /
  `hasOrgRole()` on the web side.
- The current organization is resolved per request, so a user can hold several
  organizations open in different tabs.
- Works with every auth provider Cedar supports, because all provider-specific
  work stays in the app-owned `getCurrentUser()`.
- Single-tenant apps are unaffected: nothing is added to `create-cedar-app`
  templates and nothing runs unless the setup command has been used.

## Non-Goals

- Choosing a tenancy model for users. The "Google" (separate account per org)
  and "GitHub" (must exist before invitation) models from the article are
  documented as variants in the how-to but not supported by the tooling.
- Database-per-tenant or schema-per-tenant isolation. This plan is row-level
  (shared schema, `organizationId` column).
- Postgres row-level security policies. RLS can be layered on by the app; the
  how-to mentions it, the tooling does not generate it.
- Billing, plans, seats, org-level settings UI. Those are app features that
  build on the `Organization` model; the how-to notes that the subscription
  belongs to the organization and that per-seat quantity is `memberships.count`.
- Organization types, nested organizations (parent/child) and
  organization-to-organization collaboration. All three are additive columns or
  relations on `Organization`/`Membership` that an app can add; the tooling does
  not generate them. Parent/child in particular (agencies serving client
  organizations, resellers, franchises) is a common need, but the column is the
  trivial part: a nullable `parentId` self-relation can be added by any app at
  any time with no data to migrate. What the framework deliberately does not do
  is make scoping hierarchy-aware. The extension, `setCurrentOrg` and
  `context.currentOrg` all rest on one organization per request; a parent scope
  that reads or writes child rows would have to answer which organization owns a
  `create`, whether an `update` from parent scope may touch a child row and what
  role a parent member holds in a child, and every answer weakens the fail-closed
  guarantee. Access to a child organization is therefore expressed the same way
  as any other access: a `Membership` in that organization. The how-to documents
  the pattern.
- Changing any auth provider's session or token format.

## The model

Three framework-known models. Everything else in the app is either tenant-owned
(has `organizationId`) or global.

```prisma
model Organization {
  id          String       @id @default(cuid())
  name        String
  slug        String       @unique
  createdAt   DateTime     @default(now())
  memberships Membership[]
}

model Membership {
  id              String       @id @default(cuid())
  role            String
  // Null while the membership is a pending invitation.
  userId          String?
  organizationId  String
  invitedById     String?
  invitationToken String?      @unique
  createdAt       DateTime     @default(now())
  user            User?        @relation(fields: [userId], references: [id])
  organization    Organization @relation(fields: [organizationId], references: [id])
  invitedBy       Membership?  @relation("Inviter", fields: [invitedById], references: [id])
  invitees        Membership[] @relation("Inviter")

  @@unique([userId, organizationId])
  @@index([organizationId])
}
```

`User` is the app's existing model; the setup command adds
`memberships Membership[]` to it. Rules carried over from the article, stated as
Cedar conventions:

- Every tenant-owned model has `organizationId String` plus
  `@@index([organizationId])`. `User`, `Organization` and `Membership` are the
  only models without it.
- Work is assigned to a `Membership`, not a `User` (`assigneeId` references
  `Membership.id`). This is what makes assigning to a not-yet-accepted invitee
  possible and keeps user-level assignment an intentional choice.
- An invitation is a `Membership` with `userId = null` and an `invitationToken`.
  Signup or login with `?invitationToken=` attaches the user to that row.
- `role` is a string, not an enum, so apps can add roles without a migration.
  The how-to shows how to swap in a Prisma enum.
- `Organization.slug` exists for URLs (`/org/:slug/...`). Resolving the current
  org by `id` or `slug` are both supported.
- Every user belongs to an organization from signup. Signup either claims a
  pending invitation or creates an `Organization` named after the user plus an
  `owner` `Membership`, so an app never has user-owned resources that later need
  moving into an org. The test for what belongs on the user rather than the org
  is "what if the user wants an assistant to help with this?"; if the answer is
  "they should", it is org-owned. Retrofitting orgs onto user-owned data is the
  expensive migration this feature exists to avoid.
- An invitation is claimable by any user, not only one whose email matches the
  address it was sent to. The `invitationToken` is the credential; the email is
  delivery. An existing user accepting an invitation gets the membership
  attached to their account, so one account can sit on both sides of a
  marketplace-style app through different memberships.
- `Membership` is app-extendable. Per-membership permissions beyond `role`
  (feature flags, resource-level access) are columns the app adds to the model;
  the framework only reads `role`.

### Enforcement: loose by default, strict as an opt-in

The article's "strict" variant makes `(organizationId, id)` the primary key of
every tenant-owned table. Prisma supports it (`@@id([organizationId, id])`), but
every relation then needs a compound `@relation(fields: [...])`, `findUnique`
needs the compound selector, and the scaffold generators do not produce that
shape. The default is therefore the loose model (`id` primary key,
`organizationId` indexed column) with scoping enforced by the Prisma extension
below. The how-to documents the compound-PK variant for apps that want
database-level enforcement of parent/child `organizationId` agreement
independent of application code.

## Architecture decisions

1. **New package `packages/tenancy` (`@cedarjs/tenancy`).** The runtime is a
   Prisma client extension plus context helpers. A separate package, in the
   style of `@cedarjs/storage`, keeps it out of `@cedarjs/api`'s bundle for
   single-tenant apps and stays clear of the `/db/` move
   (`unified-prisma-db-module-plan.md`), which only changes where the client is
   imported from.
2. **Current organization lives in request context, not the session.** The
   session (via `currentUser.memberships`) carries the list of
   `{ organizationId, role }` the user can access; each request names the
   organization it targets. `context.currentOrg` is set once per request and
   read lazily by the extension through `@cedarjs/context`'s `AsyncLocalStorage`
   proxy, so nothing has to be threaded through service arguments.
3. **Organization resolution is pluggable with one default.** Default order:
   `cedar-org` request header (no `X-` prefix, per RFC 6648, and matching the
   existing `auth-provider` header), then `orgId` / `orgSlug` GraphQL variable
   on the operation. Apps can replace this with their own `resolveCurrentOrg`
   function. The web client sends the header from `useCurrentOrg()`, which
   derives it from the URL by default.
4. **Membership is validated when the org is resolved.** `setCurrentOrg` takes
   only the organization's identity and derives `role` and `membershipId` from
   the authenticated user's memberships; it refuses an organization the user has
   no membership in. A custom resolver therefore cannot grant a role, and
   `context.currentOrg` is trustworthy by the time any service runs. Unauthed
   requests get no `currentOrg`, and public tenant data must be read through the
   explicit `db.$forOrg(id)` escape hatch.
5. **Missing tenant scope throws.** `TenantScopeError` is raised when a
   tenant-owned model is queried with no `currentOrg` and no explicit
   `$forOrg`/`$withoutTenant`. Background jobs, scripts and seeds must opt in
   explicitly. A loud error in development is preferable to a silent
   cross-tenant read.
6. **Nothing is provider-specific.** `getCurrentUser()` is app-owned code in
   every auth setup, so the only change is to include memberships in the
   returned user. `hasRole()` keeps working unchanged for global roles;
   `hasOrgRole()` is added beside it.

## Layer 1: `@cedarjs/tenancy` runtime

### `packages/tenancy/src/prismaExtension.ts`

```ts
export interface TenancyConfig<TClient> {
  /** Column name on tenant-owned models. Default: 'organizationId'. */
  tenantField?: string
  /** Either an explicit list of tenant-owned models, or everything except these. */
  models: ModelNamesFor<TClient>[] | { allExcept: ModelNamesFor<TClient>[] }
  /** Returns the current tenant id or undefined. Default reads context.currentOrg?.id. */
  getTenantId?: () => string | undefined
}

export function createTenancyExtension<TClient>(config: TenancyConfig<TClient>)
```

Behavior, implemented with `$allModels.$allOperations`. Every operation keeps
its own method; the extension only adds an `organizationId` equality to the
arguments:

| Operation                                                                                                                       | Injection                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `findUnique`, `findUniqueOrThrow`, `update`, `delete`, `upsert`                                                                 | `where.organizationId = tenantId` beside the unique field                                                         |
| `findFirst`, `findFirstOrThrow`, `findMany`, `count`, `aggregate`, `groupBy`, `updateMany`, `updateManyAndReturn`, `deleteMany` | `where.organizationId = tenantId` merged with `AND`                                                               |
| `create`, `createMany`, `createManyAndReturn`, `upsert.create`                                                                  | `data.organizationId = tenantId` on every row (`data` may be one object or an array); error if a row sets another |
| `update`, `updateMany`, `updateManyAndReturn`, `upsert.update`                                                                  | `data.organizationId` rejected unless equal to `tenantId`; a row can never move to another organization           |
| Nested `create`/`createMany`/`update`/`updateMany`/`upsert` under a tenant-owned relation                                       | same `data` rules, recursively                                                                                    |
| Nested `connect`/`connectOrCreate`/`disconnect`/`set` targeting a tenant-owned model                                            | `organizationId` added to the `where` (`{ id, organizationId }`); `connectOrCreate.create` gets `data` injection  |
| Nested list `include`/`select`/`_count` of a tenant-owned relation (from any model, including global ones)                      | `where.organizationId = tenantId` merged into the relation arguments                                              |
| `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe` on a scoped client                                           | `TenantScopeError`; raw SQL is only available on `db.$withoutTenant()`                                            |

The `where` rows rely on `WhereUniqueInput` accepting non-unique filter fields
next to the unique one (`{ id, organizationId }`), which Prisma supports since
5.0 and which applies to `connect` as well. The query stays a primary-key lookup
with one extra equality check; no operation is rewritten to a different one,
and a `connect` to a row in another organization fails with Prisma's
record-not-found error. Relation targets are resolved from `Prisma.dmmf`, so
the extension knows which relations point at tenant-owned models without
configuration. The one shape left to the compound-PK variant is a to-one
relation from a global model directly to a tenant-owned row; the how-to calls
that out as a modeling smell (assign to memberships, which are per
organization).

### Escape hatches: `$forOrg` and `$withoutTenant`

Client-level helpers added by the extension:

```ts
db.$forOrg(organizationId) // returns a client scoped to that org, ignoring context
db.$withoutTenant() // returns an unscoped client for system code
```

Request handling never needs either: the extension reads `context.currentOrg`
lazily, so `db.project.findMany()` in a service is already scoped. The two
helpers are for code that runs with no request context or that deliberately
works across organizations:

| Situation                                                                                | Helper                                    | Why the default scope does not apply                                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Background job (`@cedarjs/jobs`), cron, `cedar exec` script                              | `db.$forOrg(orgId)`                       | No request, so no `currentOrg`; the job receives `organizationId` as an argument |
| Seed script, data migration, admin dashboard, cross-tenant reporting                     | `db.$withoutTenant()`                     | Intentionally not scoped to one organization                                     |
| Webhook or inbound-email handler that identifies the tenant from the payload             | `db.$forOrg(orgId)`                       | The tenant is known but is not in the auth context                               |
| Public page reading one organization's data for an unauthenticated visitor               | `db.$forOrg(orgId)`                       | No user, so `setCurrentOrg` refuses to set a `currentOrg`                        |
| One request that must touch two organizations (org-to-org transfer, "copy to other org") | `db.$forOrg(otherId)` for the second side | Context holds one organization at a time                                         |

`Organization`, `Membership` and `User` are not tenant-owned, so lookups on
them, including the `resolveCurrentOrg` bootstrap query, go through plain `db`.

Both helpers return new clients from `$extends`; the shared client is not
mutated, so they are safe inside a request that is scoped to some other
organization. This is the pattern Prisma documents for per-request clients
("each HTTP request has its own client with its own RLS extension"): an extended
client is a proxy over the same engine and connection pool, and all extended
clients share that pool, so creating one per job or per request costs nothing
measurable. Create it once per unit of work (`const orgDb = db.$forOrg(id)` at
the top of `perform()`), not per query in a loop. The cost that is real is
TypeScript's: every distinct `$extends` produces a large derived type, which is
why the helpers return the same extended type with a different tenant source
instead of layering another extension.

Caveats:

- `$on` must be attached to the base client before `$extends`; the `db.ts`
  template already orders it that way and the codemod keeps that order.
- Query extensions run inside interactive transactions, so
  `db.$transaction(async (tx) => tx.project.create(...))` stays scoped.
  `$forOrg`/`$withoutTenant` clients have their own `$transaction`; do not mix a
  `tx` from one client with queries on another.
- `$withoutTenant()` disables the only check that turns a missing
  `organizationId` into an error. Code using it is responsible for every `where`
  it writes, which is why seeds and admin code are the intended callers and
  services are not.

### `packages/tenancy/src/context.ts`

```ts
export interface CurrentOrg {
  id: string
  slug: string
  role: string
  membershipId: string
}

interface Memberships {
  memberships: Array<{ organizationId: string; role: string; id: string }>
}

// Takes only the organization identity; role and membershipId are derived
// from currentUser.memberships, never from the caller, so a custom resolver
// cannot grant privileges. Throws ForbiddenError when there is no membership.
export function setCurrentOrg(
  org: { id: string; slug: string },
  currentUser: Memberships
): CurrentOrg
export function getCurrentOrg(): CurrentOrg | undefined
export function requireCurrentOrg(): CurrentOrg // throws TenantScopeError
export function resolveCurrentOrg(args: {
  event: APIGatewayProxyEvent | Request
  variables?: Record<string, unknown> // parsed GraphQL variables, when available
  currentUser: Memberships
  lookupOrg: (idOrSlug: string) => Promise<{ id: string; slug: string } | null>
}): Promise<CurrentOrg | undefined>
export function withTenancy<H extends Handler>(handler: H): H
```

`resolveCurrentOrg` reads the `cedar-org` header first and, when absent and
`variables` is provided, `variables.orgId` / `variables.orgSlug`. It calls
`setCurrentOrg` itself, so the derived `role`/`membershipId` are the only ones
that ever reach the context. `withTenancy` is for plain `api/src/functions/*`
handlers, which do not go through the GraphQL context: it runs `getCurrentUser`
via the existing auth helpers, then `resolveCurrentOrg` with the request
headers, then the wrapped handler inside that context.

`GlobalContext` in `@cedarjs/context` gains an optional `currentOrg` via
declaration merging from this package.

### `packages/tenancy/src/auth.ts`

```ts
export function hasOrgRole(
  roles: string | string[],
  organizationId?: string
): boolean
export function requireMembership(options?: { roles?: string | string[] }): void
```

`requireMembership` throws `AuthenticationError` when there is no current user,
`ForbiddenError` when there is no membership in `context.currentOrg` or the role
does not match. Same error types `requireAuth` uses so existing error handling
on the web side applies.

### Directive

`api/src/directives/requireMembership/requireMembership.ts` is generated by
setup (not exported from the package) so it is app-owned like `requireAuth`:

```graphql
directive @requireMembership(roles: [String]) on FIELD_DEFINITION
```

built with `createValidatorDirective` from `@cedarjs/graphql-server`, calling
`requireMembership({ roles })`.

### Web side (`packages/tenancy/src/web/`)

```ts
export function useCurrentOrg(): { org: CurrentOrgSummary | undefined; memberships: [...]; setOrg(idOrSlug) }
export function hasOrgRole(roles, organizationId?): boolean   // reads useAuth().currentUser.memberships
```

The active organization is held in a small module-level store, not in React
context alone, so two things that live at different depths of the tree can use
it: an Apollo link (installed in `App.tsx`, above the router) reads the store to
set the `cedar-org` header on every request, and `useCurrentOrg()` subscribes to
it. The store is written by `<OrgScope>`, which is placed inside the router
where route params exist:

```tsx
// web/src/Routes.tsx
<Set wrap={OrgScope}>
  <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
</Set>
```

`OrgScope` reads `orgSlug` with `useParams()` and writes it to the store
synchronously during render, before its children render, not in an effect. A
parent's effects run after its children's, and a Cell starts its Apollo query
as soon as it mounts, so an effect would let the first request after mounting
or switching organizations go out with no `cedar-org` header or with the
previous organization's. The write is a plain assignment of a string that is
already known, so repeating it on every render is harmless, and the link reads
the store at request time rather than capturing it. Apps that prefer a stored
selection instead of a URL segment call `setOrg` from their own switcher and
omit the `Set`. Multiple tabs on different organizations work because the
header, not the session, carries the choice.

### Jobs and scripts

`@cedarjs/jobs` executes outside a request, so `context.currentOrg` is unset.
The documented pattern is to pass `organizationId` as a job argument and use
`db.$forOrg(organizationId)` inside `perform`. `cedar exec` scripts and
`seed.ts` use `db.$withoutTenant()`. See
[Escape hatches](#escape-hatches-fororg-and-withouttenant) for the full list of
situations and the cost model.

## Layer 2: `yarn cedar setup tenancy`

`packages/cli/src/commands/setup/tenancy/`, following `setup/uploads` (command,
handler, `dbCodemod.ts`, templates, codemod tests).

Steps performed:

1. Add `@cedarjs/tenancy` to `api/package.json` and `web/package.json`.
2. Append `Organization` and `Membership` models to `api/db/schema.prisma` and
   add `memberships Membership[]` to `User`. Abort with a message if a `User`
   model does not exist (the app needs auth set up first) or if
   `Organization`/`Membership` already exist.
3. Codemod `api/src/lib/db.ts`: wrap the client in
   `.$extends(createTenancyExtension({ tenantField, models: { allExcept: ['User', 'Organization', 'Membership'] } }))`,
   where `tenantField` is the `--tenant-field` value and is omitted when it is
   the default. The `allExcept` form is the default because new models are then
   scoped automatically; forgetting to list a model fails closed.
4. Codemod `api/src/lib/auth.ts`: include `memberships` in `getCurrentUser()`
   and re-export `hasOrgRole` / `requireMembership`. `getCurrentUser()` stays
   read-only. If the file cannot be codemodded safely, print the snippet to add
   instead of guessing.
5. Codemod `api/src/functions/graphql.ts`: add a `context` function that calls
   `ensureDefaultOrganization({ currentUser, invitationToken })` (see step 8),
   which returns the user's memberships as they are after any write it made,
   and then
   `resolveCurrentOrg({ event, variables, currentUser: { ...currentUser, memberships }, lookupOrg })`,
   where `variables` are the parsed operation variables the GraphQL context
   exposes. The memberships passed to `resolveCurrentOrg` must be the returned
   ones: `getCurrentUser()` ran before `ensureDefaultOrganization`, so on a
   first login the memberships on `currentUser` are empty and membership
   validation would refuse the organization that was just created.
   `invitationToken` is read from the `cedar-invitation-token` request header,
   which the Apollo link sends while the web store holds a token; the store
   picks the token up from the `invitationToken` URL query parameter on the
   invitation landing page and clears it once a request has claimed it. A
   first-class `currentOrg` option on `createGraphQLHandler` may replace this
   boilerplate; see open questions.
6. Generate `api/src/directives/requireMembership/` with its test.
7. Generate `api/src/services/organizations/` (create org, invite, accept
   invitation, list memberships) and matching SDL, all scoped with
   `@requireMembership` / `@requireAuth` as appropriate.
8. Generate `ensureDefaultOrganization({ currentUser, invitationToken })` in
   the organizations service. It returns the user's memberships
   (`{ id, organizationId, role }[]`) as they are after it ran, so callers
   never continue with a list read before the write. It is idempotent: it
   returns the existing memberships when the user has any, otherwise creates
   the organization with the deterministic slug `user-<userId>` and an `owner`
   membership in one transaction, and treats a unique-constraint failure on
   that slug (two concurrent first requests) as "already created" and
   refetches. When `invitationToken` matches a pending membership, it attaches
   that membership instead of creating an organization. For dbAuth the
   `signup.handler` in `api/src/functions/auth.ts` is codemodded to call it
   with the token from the signup form's `userAttributes`; for every provider
   the GraphQL `context` function from step 5 calls it too, so first login
   through any provider ends with a membership before `resolveCurrentOrg` runs.
9. Generate a data migration (`yarn cedar data-migrate`, in
   `api/db/dataMigrations/`) that runs `ensureDefaultOrganization` for every
   existing `User` without a membership, in batches. Existing users otherwise
   have no `currentOrg` and every tenant-owned query for them fails by design.
   The setup output says to run `yarn cedar prisma migrate dev` and then
   `yarn cedar data-migrate up`, in that order.
10. Add the Apollo link to `web/src/App.tsx` and generate
    `web/src/components/OrgScope/OrgScope.tsx`. Routes are not edited; the
    printed next steps show the `<Set wrap={OrgScope}>`
    shape.
11. Print next steps: run the migrations, add `organizationId` to existing
    models, wrap organization routes in `OrgScope`, use `withTenancy` on any
    plain function that touches tenant-owned models.

Flags: `--tenant-field <name>` (default `organizationId`), `--force`.

## Layer 3: generator awareness

Separate, later PR. `g sdl` and `g scaffold` get a `--tenant` flag that:

- adds `organizationId String` + relation + `@@index` to the model when
  `g model`-style schema editing is involved (scaffold only reads the schema
  today, so this may reduce to a validation that the field exists),
- replaces `@requireAuth` with `@requireMembership` in the generated SDL,
- omits `organizationId` from create/update input types and forms (the extension
  injects it),
- seeds an organization and sets `context.currentOrg` in generated service tests
  via a `mockCurrentOrg()` helper exported from `@cedarjs/testing`.

This interacts with SDL field redaction (#2285) and the scaffold stub work
tracked in `sdl-stub-followups`; it is sequenced after those.

## Documentation

`docs/docs/how-to/multi-tenancy.md`, written first as the spec for Layers 1–2:

1. Which tenancy model this is and why (Linear vs. GitHub vs. Google, in the
   article's terms), and why to run `setup tenancy` before the first user-owned
   model exists rather than after.
2. Schema and the conventions (org id everywhere, assign to memberships,
   invitations are memberships, org on signup, the "assistant" test for
   org-owned vs user-owned), with a marketplace-style example where one user is
   a member on both sides.
3. `setup tenancy` walkthrough with the resulting diff.
4. Request flow: URL → header → `resolveCurrentOrg` → `context.currentOrg` →
   extension.
5. Services, directives, web hooks, with examples.
6. Jobs, scripts, seeds and `$forOrg` / `$withoutTenant`.
7. Strict variant: compound primary keys, and Postgres RLS as a second layer.
8. Agencies and parent/child organizations. One organization (an agency,
   reseller or franchisor) onboards and serves other organizations (its
   clients). The pattern keeps the runtime untouched:
   - Schema: `parentId String?` on `Organization` with a `parent` /
     `children` self-relation. The link is metadata for navigation, billing
     roll-ups and the org switcher; it has no effect on scoping.
   - Access: a `createClientOrganization` service, callable by agency members
     with a suitable role, creates the child organization and fans out
     `Membership` rows in it for the agency's staff (all of them, or a chosen
     subset, with a chosen role). Agency staff working in a client is the
     ordinary org switch; `context.currentOrg` is the client and every query is
     scoped to it.
   - Provenance: an optional `viaMembershipId String?` on `Membership`, a
     second self-relation (beside `Inviter`) that points at the agency
     membership the client membership was derived from, declared with
     `onDelete: Cascade`. Deleting the agency membership then deletes every
     client membership derived from it at the database level, so no service,
     admin tool or script can revoke agency access and leave client access
     behind. Memberships a client grants directly have `viaMembershipId` null
     and are untouched; a client that wants to keep a specific agency person
     after the agency relationship ends sets the column to null, which turns
     the row into a direct membership. The column also lets a client tell
     agency staff apart from its own members. This is shown as part of the
     pattern because retrofitting provenance onto existing memberships means
     guessing which ones were derived.
   - Cross-client work: agency-level reporting or bulk operations over all
     clients run `db.$forOrg(child.id)` per child, looked up through the
     `children` relation on plain `db`. There is no parent scope that sees
     child rows in one query.
9. Pitfalls from the article restated for Cedar: mixed auth methods per org,
   assigning to users instead of memberships, analytics group ids.

`docs/docs/tenancy.md` (reference page) is added when the package ships, in the
same shape as `uploads.md`.

## Testing

- `packages/tenancy`: unit tests for the query-argument rewriting on every
  operation in the table above, including `createManyAndReturn` /
  `updateManyAndReturn`, `createMany.data` as an object and as an array with
  one conflicting row, an `update` that tries to change `organizationId`,
  nested writes, `connect` to a row in another organization (must fail), nested
  list `include`/`select`/`_count` reached from a global model (must be
  scoped), raw queries on the scoped client (must throw), `$forOrg`,
  `$withoutTenant`, and the `TenantScopeError` path. Run against a real SQLite
  Prisma client generated from a fixture schema (the `storage` package does the
  same), not against mocks, so Prisma's argument shapes are exercised for real.
- `resolveCurrentOrg` / `setCurrentOrg`: header, `variables.orgId`,
  `variables.orgSlug`, slug/id lookup, non-member rejection, and a resolver
  that returns a forged `role: 'owner'` for a viewer membership (the context
  must hold `viewer`).
- `ensureDefaultOrganization`: idempotent on repeat calls, two concurrent
  first calls produce one organization, invitation token attaches instead of
  creating.
- The generated data migration: users with and without memberships, batch
  boundaries.
- `packages/cli` setup command: codemod tests under `__codemod_tests__` with
  `__testfixtures__` for the default `db.ts`, an already-extended `db.ts`
  (uploads), and a `db.ts` the codemod refuses to touch.
- `__fixtures__/test-project`: not changed. A new step in `tasks/test-project`
  is not added until Layer 3, to keep the fixture byte-clean check unaffected.
- Type tests: `db.project.findMany()` result types are unchanged by the
  extension; `data.organizationId` is optional on create for tenant-owned
  models.

## Sequencing

1. How-to as spec (`docs/docs/how-to/multi-tenancy.md`). Review the API on paper
   before writing code.
2. `packages/tenancy`: extension, context helpers, auth helpers, web hooks.
   Publishable on its own; usable by hand-wiring before the setup command
   exists.
3. `setup tenancy` command with codemods and generated services/directive.
4. Reference docs page and a `local-testing-project` run through the full flow
   (create org, invite, accept, scoped CRUD, two orgs in two tabs).
5. Layer 3 generator flag, after #2285 and the scaffold stub work.

Steps 1–2 do not depend on the `/db/` move; step 3's codemod targets
`api/src/lib/db.ts` by the path from `getPaths().api.db`-style resolution once
that plan lands, and the hardcoded path until then.

## Open questions

- **Where `resolveCurrentOrg` hooks in.** A `context` function on
  `createGraphQLHandler` works today but is app-owned boilerplate; a first-class
  `currentOrg` option on the handler (like `getCurrentUser`) would be cleaner
  and would let the `@cedarjs/graphql-server` cache the lookup. Decide during
  step 1.
- **RSC / server-rendered routes.** When the streaming SSR rewrite
  (`2026-07-20-streaming-ssr-rewrite.md`) gives server code direct `db` access,
  the same `context.currentOrg` needs to be set from the route param in the
  server entry. Note it there; no work in this plan.
- **Role source.** `role` as a free string on `Membership` versus a
  `MembershipRole` enum in the generated schema. Free string is the default in
  this plan; revisit if the generated organization services want exhaustive
  switch statements.
- **Prisma 8.** The extension targets Prisma 7 Client Extensions (`$extends`).
  Prisma 8 is a rewrite (release candidate as of 2026-08-26; PostgreSQL and
  MongoDB only, SQLite planned) with a different client and no `$extends`, so
  the extension has to be reimplemented when Cedar moves to Prisma 8. Nothing in
  this plan is designed around Prisma 8 before that move is planned.
- **Naming.** `organization` vs `workspace` vs `team` vs `tenant` for the model
  and the `tenantField` default. The article uses `organization`, Linear itself
  says `workspace`, Bullet Train says `team`. Never `account`: users read that
  word as their login. `organization` unless there is a strong preference.
- **Default organization on signup.** Creating an org for every user keeps the
  model uniform but produces one-member orgs that count as seats and that an
  invited user may never use. The alternative is to create the org only when the
  user is not accepting an invitation. The plan does the latter (step 8 of
  setup); confirm during the how-to review.

## References

- [The Ultimate Guide to Multi-Tenant SaaS Data Modeling](https://www.ravion.com/blog/ultimate-guide-to-multi-tenant-saas-data-modeling)
  (Ravion) — the "Linear" access model, membership-based assignment, invitations
  as memberships, and the loose/strict enforcement variants.
- [Teams Should Be an MVP Feature](https://blog.bullettrain.co/teams-should-be-an-mvp-feature/)
  (Andrew Culver, Bullet Train) — organizations from day one, the "assistant"
  test for org-owned resources, invitations claimable by any account, and
  `Membership` as the extension point for per-member permissions.
- [Prisma Client extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions)
  and the
  [row-level-security example](https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security)
  — per-request extended clients sharing one connection pool, the basis for
  `$forOrg` / `$withoutTenant`.
