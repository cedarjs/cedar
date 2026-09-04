# Multi-Tenancy

Cedar's multi-tenancy support is an opt-in way to add organizations to an app:
one user account can belong to several organizations, each membership carries
its own role, and a user can move between organizations without logging out.
Tenant scoping is enforced at the Prisma layer, so forgetting `organizationId`
on a query is a thrown error rather than a data leak.

This how-to walks through the model, the `yarn cedar setup tenancy` command, the
request flow, and the patterns for services, jobs, scripts and agencies. For the
API reference (every export, every option), see [Tenancy](../tenancy.md).

## 1. Which tenancy model this is, and why

[The Ultimate Guide to Multi-Tenant SaaS Data Modeling](https://www.ravion.com/blog/ultimate-guide-to-multi-tenant-saas-data-modeling)
describes three common shapes for how user accounts relate to organizations:

- **Google**: a separate account per organization. Signing into a different
  organization means a different login.
- **GitHub**: a single account, but an organization must already exist before
  you can be invited to it.
- **Linear**: a single account that can hold memberships in many organizations
  at once, each with its own role, switchable without logging out.

Cedar's tooling builds the Linear model. It is the shape that scales best from a
one-person app to a team-based SaaS product without a data migration: a user's
identity and their organization membership are separate concepts from the start.

The Google and Google-style single-account-per-org and GitHub-style
invite-only-to-existing-org models are valid choices for some products, and
nothing in `@cedarjs/tenancy` prevents building them by hand (a single-org model
is just a Linear-model app that never lets a user create a second organization).
The setup command and the generated services assume the Linear model; the other
two are not generated.

### Run `setup tenancy` before the first user-owned model exists

Run `yarn cedar setup tenancy` as one of the first things you do after
`yarn cedar setup auth`, before you write your first `g scaffold` or `g model`
for actual application data.

The reason is retrofitting. Once a `Project` or `Document` model exists with
rows owned directly by a `User`, giving it to an organization means a migration
that decides, for every existing row, which organization it belongs to. That
decision does not exist in the data: a user with three projects that are
actually three different clients' work has no `organizationId` to backfill from.
Running `setup tenancy` first means every model you add afterwards is
tenant-owned from its first migration, and the question never comes up.

## 2. Schema and conventions

`setup tenancy` adds two models to `api/db/schema.prisma` and a relation to your
existing `User` model:

```prisma title="api/db/schema.prisma"
model Organization {
  id          String       @id @default(cuid())
  name        String
  slug        String       @unique
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
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
  updatedAt       DateTime     @updatedAt
  user            User?        @relation(fields: [userId], references: [id])
  organization    Organization @relation(fields: [organizationId], references: [id])
  invitedBy       Membership?  @relation("Inviter", fields: [invitedById], references: [id])
  invitees        Membership[] @relation("Inviter")

  @@unique([userId, organizationId])
  @@index([organizationId])
}

model User {
  // ...your existing fields
  // highlight-next-line
  memberships Membership[]
}
```

`Organization`, `Membership` and `User` are the only models without
`organizationId`. The extension `setup tenancy` wires up in `db.ts` defaults to
`allExcept: ['user', 'organization', 'membership']`, which means every _other_
existing model -- not just ones you add later -- is tenant-owned from the moment
setup finishes: its queries throw `TenantScopeError` until you either add
`organizationId String` plus `@@index([organizationId])` to it, or add it to
that `allExcept` list because it's meant to stay global. The conventions below
are carried over from the article, stated as Cedar defaults:

- **Every tenant-owned model gets `organizationId String` plus
  `@@index([organizationId])`.** This is what the Prisma extension (see
  [section 4](#4-request-flow-url-to-header-to-context)) scopes on.
- **Work is assigned to a `Membership`, not a `User`.** An `assigneeId` field
  references `Membership.id`, not `User.id`. This lets you assign work to
  someone who has been invited but hasn't signed up yet, and it keeps "assign to
  this user across every organization they're in" an explicit choice you'd have
  to build rather than something that falls out of the schema by accident.
- **An invitation is a `Membership` with `userId = null`.** The
  `invitationToken` column is the credential. Signing up or logging in with
  `?invitationToken=` attaches the authenticated user to that row.
- **`role` is a string, not an enum**, so an app can add roles without a schema
  migration. See
  [section 7](#7-strict-variant-compound-primary-keys-and-postgres-rls) for
  swapping in a Prisma enum.
- **`Organization.slug` exists for URLs** (`/org/acme/projects`). Resolving the
  current organization by `id` or by `slug` are both supported.
- **Every user belongs to an organization from signup.** Signup either claims a
  pending invitation or creates an `Organization` named after the user with an
  `owner` membership, so an app never accumulates user-owned resources that
  later need moving into an organization.

### The assistant test

When you're deciding whether a new model belongs to the user or to the
organization, ask: _if the user wanted to hire an assistant to help with this,
could the assistant do it without being that user?_ If the answer is yes, the
resource is organization-owned, not user-owned. A user's dashboard layout
preference is theirs alone; a client's project plan is something a teammate or a
hired assistant should be able to open, edit and hand back. Almost everything in
a B2B app is a "yes" under this test, which is why the loose default is to treat
everything as tenant-owned and name exceptions explicitly (see
[section 3](#3-setup-tenancy-walkthrough)).

### One user, two organizations: a marketplace example

Because an invitation is claimable by any account, and because the current
organization is resolved per request rather than stored on the session, one user
account can hold memberships on both sides of a two-sided app. Consider a
marketplace where organizations can be either vendors or buyers (a `type` column
on `Organization`, or two separate membership roles &mdash; the schema doesn't
care):

```
User: dana@example.com
├── Membership { organizationId: acme-hardware,  role: "owner" }   // Dana runs Acme Hardware, a vendor
└── Membership { organizationId: dana-consulting, role: "owner" }  // Dana also buys supplies for her own consultancy
```

Dana logs in once. Switching from `/org/acme-hardware/products` to
`/org/dana-consulting/orders` is a route change, not a new login, and each tab
or route resolves `context.currentOrg` independently from the `cedar-org` header
or the `orgSlug` route param (see
[section 4](#4-request-flow-url-to-header-to-context)). Nothing about
`hasOrgRole()`, `requireMembership()` or the Prisma extension needs to know that
the same `userId` sits behind both memberships; each request only ever has one
organization in scope.

## 3. `setup tenancy` walkthrough

```shell
yarn cedar setup tenancy
```

Flags:

| Flag                    | Default          | What it does                                                          |
| ----------------------- | ---------------- | --------------------------------------------------------------------- |
| `--tenant-field <name>` | `organizationId` | The column name the extension scopes on, on every tenant-owned model. |
| `--force`               | off              | Overwrite generated files that already exist.                         |

The command requires a `User` model to already exist (run
`yarn cedar setup auth` first) and aborts if `Organization` or `Membership` are
already defined in `schema.prisma`.

### What `setup tenancy` changes

| File                                                                | Change                                                                                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/db/schema.prisma`                                              | Adds `Organization` and `Membership`, adds `memberships Membership[]` to `User`, adds `RW_DataMigration` if `data-migrate install` has not run yet |
| `api/src/lib/db.ts`                                                 | Wraps `db` in `createTenancyExtension`                                                                                                             |
| `api/src/lib/auth.ts`                                               | Adds `memberships` to the `getCurrentUser()` select, re-exports `hasOrgRole` / `requireMembership`                                                 |
| `api/src/functions/graphql.ts`                                      | Adds a `context` function that resolves `currentOrg` per request                                                                                   |
| `api/src/functions/auth.ts`                                         | (dbAuth only) Wraps `signup.handler` to call `ensureDefaultOrganization`                                                                           |
| `api/src/directives/requireMembership/`                             | Generates the `@requireMembership` directive                                                                                                       |
| `api/src/services/organizations/`                                   | Generates the organizations service and SDL                                                                                                        |
| `api/db/dataMigrations/<timestamp>-ensure-default-organizations.ts` | Backfills memberships for existing users                                                                                                           |
| `web/src/components/OrgScope/OrgScope.tsx`                          | Generates the app-owned `OrgScope` wrapper                                                                                                         |
| `web/src/pages/InvitePage/InvitePage.tsx`                           | Generates the invitation landing page                                                                                                              |
| `api/package.json`, `web/package.json`                              | Adds `@cedarjs/tenancy`                                                                                                                            |

`db.ts` gains the tenancy extension, chained after any existing extensions (such
as `@cedarjs/storage`'s):

```diff title="api/src/lib/db.ts"
+import { createTenancyExtension } from '@cedarjs/tenancy'

 const prismaClient = new PrismaClient({
   log: emitLogLevels(['info', 'warn', 'error']),
 })

-export const db = prismaClient
+export const db = prismaClient.$extends(
+  createTenancyExtension<typeof prismaClient>({
+    models: { allExcept: ['user', 'organization', 'membership'] },
+  }),
+)
```

`auth.ts` gains `memberships` in the `getCurrentUser()` select and re-exports
the org-aware helpers:

```diff title="api/src/lib/auth.ts"
 export const getCurrentUser = async (session) => {
   return db.user.findUnique({
     where: { id: session.id },
-    select: { id: true, email: true, roles: true },
+    select: {
+      id: true,
+      email: true,
+      roles: true,
+      memberships: {
+        select: {
+          id: true,
+          organizationId: true,
+          role: true,
+          organization: { select: { id: true, slug: true, name: true } },
+        },
+      },
+    },
   })
 }

+export { hasOrgRole, requireMembership } from '@cedarjs/tenancy'
```

`graphql.ts` gains a `context` function that resolves the current organization
before any resolver runs:

```diff title="api/src/functions/graphql.ts"
+import { isUserWithMemberships, resolveCurrentOrg } from '@cedarjs/tenancy'

 export const handler = createGraphQLHandler({
   getCurrentUser,
   loggerConfig: { logger, options: {} },
   directives,
   sdls,
   services,
+  context: async ({ context: gqlContext }) => {
+    const { currentUser, event, request, params } = gqlContext
+    // A user whose getCurrentUser result doesn't carry memberships can't be
+    // matched to an organization, so the request runs with none set.
+    if (!isUserWithMemberships(currentUser)) {
+      return {}
+    }
+
+    // Yoga populates `event` on Lambda-style deployments and `request` on
+    // Fetch-API-style ones; resolveCurrentOrg reads the header off either.
+    const requestEvent = event ?? request
+    if (!requestEvent) {
+      return {}
+    }
+
+    const currentOrg = await resolveCurrentOrg({
+      event: requestEvent,
+      variables: params.variables,
+      currentUser,
+      lookupOrg: async (idOrSlug) =>
+        (await db.organization.findUnique({
+          where: { id: idOrSlug },
+          select: { id: true, slug: true },
+        })) ??
+        db.organization.findUnique({
+          where: { slug: idOrSlug },
+          select: { id: true, slug: true },
+        }),
+    })
+
+    return { currentOrg }
+  },
   onException: () => {
     db.$disconnect()
   },
 })
```

For dbAuth apps, `functions/auth.ts` gains the same call in the signup handler,
so a first signup gets a default organization (or claims a pending invitation)
before the user is ever logged in:

```diff title="api/src/functions/auth.ts"
+import { ensureDefaultOrganization } from 'src/services/organizations/organizations'

 interface UserAttributes {
   name: string
+  invitationToken?: string
 }

 const signupOptions: DbAuthHandlerOptions<UserType, UserAttributes>['signup'] = {
-  handler: ({ username, hashedPassword, salt, userAttributes: _userAttributes }) => {
-    return db.user.create({
-      data: { email: username, hashedPassword, salt },
-    })
-  },
+  handler: async ({ username, hashedPassword, salt, userAttributes }) => {
+    const user = await db.user.create({
+      data: { email: username, hashedPassword, salt },
+    })
+
+    await ensureDefaultOrganization({
+      currentUser: { id: user.id, memberships: [] },
+      invitationToken: userAttributes.invitationToken,
+    })
+
+    return user
+  },
   // ...
 }
```

`currentUser` is built as `{ id: user.id, memberships: [] }` rather than passed
as the created `user` directly: `db.user.create(...)`'s result has no
`memberships` field, and an empty array is always correct for a user that was
just created. When `signupOptions` has no local `interface UserAttributes`, the
codemod skips adding `invitationToken?: string` rather than guessing at an
unfamiliar shape; add it by hand in that case.

Finally, `Organization` and `Membership` are appended to `schema.prisma`, and
`User` gains the relation:

```diff title="api/db/schema.prisma"
 model User {
   id    String @id @default(cuid())
   email String @unique
   // ...your existing fields
+  memberships Membership[]
 }
+
+model Organization {
+  id          String       @id @default(cuid())
+  name        String
+  slug        String       @unique
+  createdAt   DateTime     @default(now())
+  memberships Membership[]
+}
+
+model Membership {
+  id              String       @id @default(cuid())
+  role            String
+  userId          String?
+  organizationId  String
+  invitedById     String?
+  invitationToken String?      @unique
+  createdAt       DateTime     @default(now())
+  user            User?        @relation(fields: [userId], references: [id])
+  organization    Organization @relation(fields: [organizationId], references: [id])
+  invitedBy       Membership?  @relation("Inviter", fields: [invitedById], references: [id])
+  invitees        Membership[] @relation("Inviter")
+
+  @@unique([userId, organizationId])
+  @@index([organizationId])
+}
```

Setup also adds the `RW_DataMigration` model if it isn't already there (the one
`yarn cedar data-migrate install` adds) -- `data-migrate up` fails outright
without it, and most projects run `setup tenancy` before they've ever written a
data migration.

Run the two commands the setup output prints, in order:

```shell
yarn cedar prisma migrate dev
yarn cedar data-migrate up
```

The migration creates the tables (`Organization`, `Membership` and, if it was
just added, `RW_DataMigration`); the data migration backfills a default
organization and membership for every existing user, so nobody is left without a
`currentOrg` to resolve into.

The setup command does not touch `web/src/Routes.tsx` or `web/src/App.tsx`, and
it does not decide which of your existing models are tenant-owned &mdash; it
prints the next steps instead: scope or exempt every existing model as described
above, wire up section 5's `<Set wrap={[OrgScope, OrgLayout]}>` shape and the
`/invite/{token}` route, and use `withTenancy` from `@cedarjs/tenancy` on any
plain `api/src/functions/*` handler that touches tenant-owned models.

## 3b. Auth providers other than dbAuth

`setup tenancy` requires auth to be set up first, and it wires the rest of the
way automatically only for dbAuth. Everything the runtime needs is the same
whichever provider you use, but with an external provider you supply two
pieces yourself.

**A `User` row for every person.** `Membership.userId` is a foreign key to
`User.id`, so tenancy needs a row in your database for each member. dbAuth
creates the `User` model and writes the row at signup. Clerk, Supabase,
Auth0, Firebase, Netlify and SuperTokens authenticate against their own
service, so someone can be fully signed in and still have no row here.
`setup tenancy` stops with instructions when the model is missing, and it is
up to you to create rows for people as they arrive.

**Memberships on `getCurrentUser`.** The organization for a request is
validated against `currentUser.memberships`, so `getCurrentUser` has to return
them. For dbAuth the setup command adds the selection to the existing query.
For an external provider `getCurrentUser` receives a decoded token rather than
a database row, so there is nothing to extend and the command prints the shape
to add instead.

Put both in `getCurrentUser`, since it runs before anything tenancy does:

```ts title="api/src/lib/auth.ts"
export const getCurrentUser = async (decoded) => {
  if (!decoded) {
    return null
  }

  // Whatever your provider calls the subject of the token.
  const providerUserId = decoded.sub

  const user = await db.user.upsert({
    where: { authProviderId: providerUserId },
    create: { authProviderId: providerUserId, email: decoded.email },
    update: {},
    select: {
      id: true,
      email: true,
      memberships: {
        select: {
          id: true,
          organizationId: true,
          role: true,
          organization: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  })

  return user
}
```

:::tip Keep your own `id`

Store the provider's subject in its own column, as `authProviderId` does
above, rather than using it as `User.id`. Every membership points at `User.id`,
so making it the provider's id welds your data to that provider: switching
providers, or letting one person sign in through two of them, then means
rewriting every foreign key. An app that needs several providers at once can
give `User` a related table keyed by `[provider, providerUserId]`, which is
the shape `setup auth dbAuth --oauth` generates as its `OAuth` model.

:::

Giving each new person an organization is yours to decide too. The generated
`ensureDefaultOrganization` in `api/src/services/organizations/organizations`
does it, and is what dbAuth's signup handler calls; call it wherever your app
learns about a new user, or write your own rule. Until a user has a
membership, every tenant-owned query for them fails with `TenantScopeError`,
which is the intended fail-closed behaviour rather than a silent empty list.

## 4. Request flow: URL to header to context

Every GraphQL request that carries a current organization goes through the same
four steps:

1. **URL or variable.** The web app is either on a route like
   `/org/acme/projects` (an `orgSlug` route param) or has an organization
   id/slug available some other way (a switcher stored in state, for example).
2. **Header.** `OrgScope` (see
   [section 5](#5-services-directives-and-web-hooks)) builds a per-organization
   Apollo client that sends a `cedar-org` header with every request. This is the
   default source `resolveCurrentOrg` looks at first.
3. **`resolveCurrentOrg`.** On the API side, the generated `context` function
   (shown in section 3) calls
   `resolveCurrentOrg({ event, variables, currentUser, lookupOrg })`. It reads,
   in order: the `cedar-org` request header, then the `orgId` GraphQL variable,
   then the `orgSlug` variable. Whichever it finds is looked up with
   `lookupOrg`, and the result is passed to `setCurrentOrg`, which derives
   `role` and `membershipId` from `currentUser.memberships` and refuses
   (`ForbiddenError`) an organization the user has no membership in. A custom
   resolver can never grant a role it wasn't given by an actual membership.
4. **`context.currentOrg`.** The resolved `{ id, slug, role, membershipId }` is
   written to `context.currentOrg` via `@cedarjs/context`'s `AsyncLocalStorage`
   proxy, once per request. The Prisma extension reads it lazily on every
   tenant-owned query, so a plain `db.project.findMany()` inside a service is
   already scoped, with nothing threaded through service arguments.

When there's no authenticated user, `resolveCurrentOrg` is skipped and
`context.currentOrg` stays unset &mdash;
public tenant data has to go through `db.$forOrg(id)` explicitly (see
[section 6](#6-jobs-scripts-seeds-and-fororg--withouttenant)).

## 5. Services, directives, and web hooks

### Generated organization service

`setup tenancy` generates `api/src/services/organizations/organizations.ts` and
its SDL:

```graphql title="api/src/graphql/organizations.sdl.ts"
type Membership {
  id: String!
  role: String!
  organizationId: String!
  organization: Organization!
}

type Organization {
  id: String!
  name: String!
  slug: String!
}

"""
inviteMember's result. invitationToken isn't a Membership field: Membership
is readable by any member, and a selectable invitationToken there would let
any member read a pending invitation's token and claim it themselves.
Invitation exists only as inviteMember's return type, so the token reaches
only the caller who just created the invitation.
"""
type Invitation {
  membership: Membership!
  invitationToken: String!
}

type Query {
  myMemberships: [Membership!]! @requireAuth
  organization(id: String!): Organization @requireMembership
}

input CreateOrganizationInput {
  name: String!
}

input InviteMemberInput {
  organizationId: String!
  email: String!
  role: String!
}

type Mutation {
  # Web callers must call `reauthenticate()` in `onCompleted`; this mutation
  # changes the memberships that the currentUser snapshot on the web holds.
  createOrganization(input: CreateOrganizationInput!): Organization!
    @requireAuth

  # Web callers must call `reauthenticate()` in `onCompleted`.
  inviteMember(input: InviteMemberInput!): Invitation!
    @requireMembership(roles: ["owner", "admin"])

  # Web callers must call `reauthenticate()` in `onCompleted`.
  acceptInvitation(token: String!): Organization! @requireAuth

  # Web callers must call `reauthenticate()` in `onCompleted`.
  removeMember(membershipId: String!): Membership!
    @requireMembership(roles: ["owner", "admin"])
}
```

```ts title="api/src/services/organizations/organizations.ts"
import { db } from 'src/lib/db'
import { hasOrgRole, requireMembership, requireCurrentOrg } from 'src/lib/auth'

// Which role a membership with a given role may grant (inviteMember) or
// revoke (removeMember). An app adds a role here when it adds one to its
// own `Membership.role` values; a role missing from this map can't be
// granted to, or removed from, anyone.
const ROLE_GRANTS = {
  owner: ['owner', 'admin', 'member'],
  admin: ['admin', 'member'],
  member: [],
}

const canGrantRole = (granterRole, targetRole) =>
  ROLE_GRANTS[granterRole]?.includes(targetRole) ?? false

export const myMemberships = () => {
  return db.membership.findMany({
    where: { userId: context.currentUser.id },
    include: { organization: true },
  })
}

export const organization = () => {
  const currentOrg = requireCurrentOrg()
  return db.organization.findUnique({ where: { id: currentOrg.id } })
}

export const inviteMember: MutationResolvers['inviteMember'] = ({ input }) => {
  const currentOrg = requireCurrentOrg()

  // @requireMembership(roles: ["owner", "admin"]) on the SDL only checks
  // that the caller is an owner or admin of *some* organization; whether
  // *this* role may be granted is checked here, against the caller's own
  // role, so an admin can invite an admin or a member but never an owner.
  if (!canGrantRole(currentOrg.role, input.role)) {
    throw new ForbiddenError(
      `A "${currentOrg.role}" cannot invite a "${input.role}".`
    )
  }

  const invitationToken = crypto.randomUUID()

  const membership = await db.membership.create({
    data: {
      organizationId: currentOrg.id,
      role: input.role,
      invitedById: currentOrg.membershipId,
      invitationToken,
    },
  })

  return { membership, invitationToken }
}
```

`Organization` and `Membership` are global models, so these lookups use plain
`db`, not `db.$forOrg`. `removeMember` reuses the same `canGrantRole` check,
plus a check that the membership being removed isn't the organization's last
`owner`, so an admin can never remove an owner and an organization can never end
up with zero owners. `acceptInvitation` claims a pending invitation with a
single `updateMany` guarded by `{ invitationToken: token, userId: null }`, so
two concurrent accepts of the same token can never both win, and it spends the
token in that same write so it can't be replayed by anyone who observed it
beforehand.

### `@requireMembership`

The generated directive works like `@requireAuth`, but checks organization
membership and (optionally) role:

```ts title="api/src/directives/requireMembership/requireMembership.ts"
import { createValidatorDirective } from '@cedarjs/graphql-server'
import { requireMembership } from 'src/lib/auth'

const schema = /* GraphQL */ `
  directive @requireMembership(roles: [String]) on FIELD_DEFINITION
`

const requireMembershipValidate = ({ directiveArgs }) => {
  const { roles } = directiveArgs
  requireMembership({ roles })
}

const requireMembershipDirective = createValidatorDirective(
  schema,
  requireMembershipValidate
)

export default requireMembershipDirective
```

`requireMembership()` throws `AuthenticationError` when there's no
`context.currentUser`, and `ForbiddenError` when there's no `context.currentOrg`
or the current org's role doesn't match `roles`. These are the same error types
`requireAuth` throws, so any error handling you already have on the web side
keeps working.

### Web hooks: `OrgScope`, `useCurrentOrg`, `hasOrgRole`

`OrgScope` wraps organization routes with `Set`'s `wrap` prop, next to your
layout:

```tsx title="web/src/Routes.tsx"
import { Set, Route, Router } from '@cedarjs/router'

import OrgScope from 'src/components/OrgScope/OrgScope'
import OrgLayout from 'src/layouts/OrgLayout/OrgLayout'

const Routes = () => {
  return (
    <Router>
      <Route path="/invite/{token}" page={InvitePage} name="invite" />
      {/* highlight-next-line */}
      <Set wrap={[OrgScope, OrgLayout]}>
        <Route
          path="/org/{orgSlug}/projects"
          page={ProjectsPage}
          name="projects"
        />
        <Route
          path="/org/{orgSlug}/settings"
          page={OrgSettingsPage}
          name="orgSettings"
        />
      </Set>
    </Router>
  )
}

export default Routes
```

`OrgScope` reads the `orgSlug` route param, matches it against
`useAuth().currentUser.memberships`, and renders a nested `<ApolloProvider>`
with an organization-scoped client under it, so every Cell, `useQuery` and
`useMutation` inside the `Set` carries the `cedar-org` header automatically.
When the slug doesn't match a membership it renders the app's not-a-member state
instead of its children.

:::note[Routes under `OrgScope` must not carry `prerender`]

`OrgScope`'s nested `ApolloProvider` shadows the per-route client that
prerendering injects above `App`, so a prerendered page's queries wouldn't go
through the in-process GraphQL link the prerenderer expects. Organization routes
are per-user by nature anyway &mdash; don't add `prerender` to a `Route` or
`Set` that lives inside `<Set wrap={[OrgScope, ...]}>`.

:::

Inside the `Set`, read the current organization with `useCurrentOrg()`:

```tsx title="web/src/components/ProjectList/ProjectList.tsx"
import { useCurrentOrg } from '@cedarjs/tenancy/web'

const ProjectList = () => {
  const { org, hasOrgRole } = useCurrentOrg()

  return (
    <div>
      <h1>{org?.name} projects</h1>
      {hasOrgRole(['owner', 'admin']) && <NewProjectButton />}
    </div>
  )
}
```

`hasOrgRole(roles, organizationId?)` behaves like `useAuth().hasRole()`, but
scoped to an organization: with no `organizationId` argument it checks the
current organization's role from `useCurrentOrg()`; passed an `organizationId`,
it checks `currentUser.memberships` for a match, which is how you'd show a
switcher entry as disabled for an organization the user isn't an admin of,
without navigating there first.

### `reauthenticate()` after membership-changing mutations

`currentUser.memberships` on the web is a snapshot taken at authentication, not
live data. The API side re-validates against fresh memberships on every request,
because `getCurrentUser()` runs per request &mdash; a member removed mid-session
is refused immediately by the API. The web side keeps believing the old snapshot
until something refreshes it.

This is why the generated SDL comments say what they say: **any web-side caller
of a mutation that changes memberships or the organizations they point to**
&mdash; `createOrganization`, `inviteMember`, `acceptInvitation`,
`removeMember`, a role change, an organization rename &mdash; must call
`reauthenticate()` from `useAuth()` in that mutation's `onCompleted`:

```tsx title="web/src/components/AcceptInvitationForm/AcceptInvitationForm.tsx"
import { useMutation } from '@cedarjs/web'
import { useAuth } from 'src/auth'

const ACCEPT_INVITATION_MUTATION = gql`
  mutation AcceptInvitationMutation($token: String!) {
    acceptInvitation(token: $token) {
      id
      slug
    }
  }
`

const AcceptInvitationForm = ({ token }: { token: string }) => {
  const { reauthenticate } = useAuth()

  const [acceptInvitation] = useMutation(ACCEPT_INVITATION_MUTATION, {
    variables: { token },
    context: { headers: { 'cedar-invitation-token': token } },
    // highlight-start
    onCompleted: async () => {
      await reauthenticate()
    },
    // highlight-end
  })

  return <button onClick={() => acceptInvitation()}>Accept</button>
}
```

Skipping `reauthenticate()` doesn't corrupt any data &mdash; the API is
authoritative and re-checks membership on every request &mdash; but it does mean
the org switcher, `hasOrgRole()` on the web and the slugs `OrgScope` matches
routes against can all lag behind reality until the next full page load or
login. A newly accepted invitation won't show up in the switcher; a role change
won't be reflected in a `hasOrgRole()` check; a renamed organization's old slug
will render the not-a-member state even though the membership is still there.

## 6. Jobs, scripts, seeds and `$forOrg` / `$withoutTenant`

`context.currentOrg` only exists inside a request. `@cedarjs/jobs`, `cedar exec`
scripts and `seed.ts` all run outside a request, so a plain
`db.project.findMany()` inside any of them throws `TenantScopeError`. Two escape
hatches, both added by the tenancy extension:

```ts
db.$forOrg(organizationId) // a client scoped to that one org, ignoring context
db.$withoutTenant() // an unscoped client for system code
```

| Situation                                                                                | Helper                                    | Why                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Background job, cron, `cedar exec` script                                                | `db.$forOrg(orgId)`                       | No request, so no `currentOrg`; the job receives `organizationId` as an argument |
| Seed script, data migration, admin dashboard, cross-tenant reporting                     | `db.$withoutTenant()`                     | Intentionally not scoped to one organization                                     |
| Webhook or inbound-email handler that identifies the tenant from the payload             | `db.$forOrg(orgId)`                       | The tenant is known but isn't in the auth context                                |
| Public page reading one organization's data for an unauthenticated visitor               | `db.$forOrg(orgId)`                       | No user, so `setCurrentOrg` refuses to set a `currentOrg`                        |
| One request that must touch two organizations (org-to-org transfer, "copy to other org") | `db.$forOrg(otherId)` for the second side | Context holds one organization at a time                                         |

### Jobs

Pass `organizationId` as a job argument and scope inside `perform()`, the same
way you'd pass any other id:

```ts title="api/src/jobs/GenerateReportJob/GenerateReportJob.ts"
import { db } from 'src/lib/db'
import { jobs } from 'src/lib/jobs'

export const GenerateReportJob = jobs.createJob({
  queue: 'default',
  perform: async (organizationId: string) => {
    // highlight-next-line
    const orgDb = db.$forOrg(organizationId)

    const projects = await orgDb.project.findMany()
    // ...build and store the report
  },
})
```

Create the scoped client once per unit of work, at the top of `perform()`, not
per query in a loop &mdash; `$forOrg` returns a new client each call, and while
that's cheap at runtime (it's a proxy over the same engine and connection pool
every extended client shares), TypeScript has to derive a type for each one.

### `cedar exec` scripts and seeds

```ts title="scripts/backfillProjectDescriptions.ts"
import { db } from 'api/src/lib/db'

export default async () => {
  // highlight-next-line
  const orgDb = db.$withoutTenant()

  const projects = await orgDb.project.findMany({
    where: { description: null },
  })
  // ...
}
```

```ts title="api/db/seed.ts"
import { db } from 'api/src/lib/db'

export default async () => {
  // highlight-next-line
  const orgDb = db.$withoutTenant()

  const org = await orgDb.organization.create({
    data: { name: 'Acme', slug: 'acme' },
  })

  await orgDb.project.create({
    data: { organizationId: org.id, name: 'Website redesign' },
  })
}
```

`db.$withoutTenant()` disables the only check that turns a missing
`organizationId` into an error, so code using it is responsible for every
`where` and `data` it writes. That's exactly why seeds, data migrations and
admin tooling are the intended callers, and services are not: a service that
reached for `$withoutTenant()` to make a `TenantScopeError` go away has usually
found a modeling problem, not fixed one.

## 7. Strict variant: compound primary keys, and Postgres RLS

### Compound primary keys

The default schema uses a plain `id` primary key with an indexed
`organizationId` column (the "loose" model), and the Prisma extension enforces
scoping in application code. The article's "strict" variant makes
`(organizationId, id)` the compound primary key of every tenant-owned table
instead:

```prisma
model Project {
  id             String @default(cuid())
  organizationId String
  name           String

  organization Organization @relation(fields: [organizationId], references: [id])

  @@id([organizationId, id])
}
```

Prisma supports this, but it has real costs the loose model avoids: every
relation into a compound-PK model needs a compound
`@relation(fields: [...], references: [...])`, every `findUnique` needs the full
compound selector (`{ organizationId_id: { organizationId, id } }`) instead of
just `{ id }`, and Cedar's scaffold generators produce the loose shape, not this
one. It buys you something the loose model can't: database-level enforcement
that a row's `organizationId` can never disagree with the `organizationId` on
the parent it hangs off, independent of whether any application code got the
scoping right. Reach for it on tables where that guarantee matters more than the
ergonomics cost &mdash; financial ledgers, audit logs &mdash; not as the
app-wide default.

### Postgres row-level security as a second layer

The Prisma extension is Cedar's only generated layer of tenant isolation, but
nothing stops an app running Postgres from adding row-level security (RLS)
policies as a second, independent layer:

```sql
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Project"
  USING ("organizationId" = current_setting('app.current_org_id')::text);
```

RLS is defense in depth, not a replacement: it catches the case the extension
can't &mdash; a raw query, a migration script, an ORM other than Prisma, a bug
in the extension itself &mdash; by making the database itself refuse a query
with the wrong session-level `app.current_org_id` set. It doesn't remove the
need for `db.$forOrg`/`db.$withoutTenant`, since those still decide _which_
organization id gets set for the session; RLS is what happens if something
forgets to check. Setting `app.current_org_id` per request and wiring it through
Prisma's connection pool is app-specific work Cedar doesn't generate; see
[Prisma's row-level-security example](https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security)
for the pattern the extension itself is modeled on.

## 8. Agencies and parent/child organizations

A common shape the tooling doesn't generate, but that the model supports without
any change to the runtime: one organization (an agency, reseller or franchisor)
onboards and serves other organizations (its clients).

### Schema: `parentId`

Add a nullable self-relation to `Organization`:

```prisma title="api/db/schema.prisma"
model Organization {
  id          String         @id @default(cuid())
  name        String
  slug        String         @unique
  createdAt   DateTime       @default(now())
  memberships Membership[]

  // highlight-start
  parentId    String?
  parent      Organization?  @relation("Agency", fields: [parentId], references: [id])
  children    Organization[] @relation("Agency")
  // highlight-end
}
```

This link is metadata &mdash; navigation, billing roll-ups, the org switcher
grouping clients under their agency &mdash; and it has no effect on scoping. The
Prisma extension, `setCurrentOrg` and `context.currentOrg` all rest on exactly
one organization per request; there is no parent scope that reads or writes rows
belonging to a child. That's deliberate: a parent scope that could touch child
rows would have to answer which organization owns a `create`, whether an
`update` issued from parent scope may touch a child's row, and what role a
parent member holds in a child &mdash; and every answer weakens the fail-closed
guarantee the extension gives you everywhere else. Access to a client
organization is expressed the same way as any other access: a `Membership` in
that organization.

### Access: `createClientOrganization`

An agency-side service creates the child organization and fans out memberships
for the agency's staff:

```ts title="api/src/services/organizations/organizations.ts"
import { db } from 'src/lib/db'
import { requireMembership, requireCurrentOrg } from 'src/lib/auth'

export const createClientOrganization = async ({
  name,
  slug,
  staffMemberships,
}: {
  name: string
  slug: string
  staffMemberships: Array<{ agencyMembershipId: string; role: string }>
}) => {
  requireMembership({ roles: ['owner', 'admin'] })
  const agencyOrg = requireCurrentOrg()

  return db.organization.create({
    data: {
      name,
      slug,
      parentId: agencyOrg.id,
      memberships: {
        create: staffMemberships.map(({ agencyMembershipId, role }) => ({
          role,
          userId: /* the agency staff member's userId, looked up from agencyMembershipId */,
          viaMembershipId: agencyMembershipId,
        })),
      },
    },
  })
}
```

An agency staff member working inside a client organization is an ordinary
organization switch: `useCurrentOrg().setOrg(clientSlug)` navigates there,
`context.currentOrg` becomes the client, and every query for the rest of that
request is scoped to it exactly like any other organization.

### Provenance: `viaMembershipId` with `onDelete: Cascade`

An optional column on `Membership` records which agency membership a client
membership was derived from:

```prisma title="api/db/schema.prisma"
model Membership {
  id              String       @id @default(cuid())
  role            String
  userId          String?
  organizationId  String
  invitedById     String?
  invitationToken String?      @unique
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  user            User?        @relation(fields: [userId], references: [id])
  organization    Organization @relation(fields: [organizationId], references: [id])
  invitedBy       Membership?  @relation("Inviter", fields: [invitedById], references: [id])
  invitees        Membership[] @relation("Inviter")

  // highlight-start
  viaMembershipId String?
  viaMembership   Membership?  @relation("AgencyProvenance", fields: [viaMembershipId], references: [id], onDelete: Cascade)
  derivedMemberships Membership[] @relation("AgencyProvenance")
  // highlight-end

  @@unique([userId, organizationId])
  @@index([organizationId])
}
```

`onDelete: Cascade` is the point of the column: deleting the agency membership
deletes every client membership derived from it, at the database level. No
service, admin tool or script has to remember to revoke client access when
agency access is revoked &mdash; it happens even if the code that removed the
agency membership never thought about clients at all. Memberships a client
grants directly have `viaMembershipId` null and are untouched by anything that
happens on the agency side. A client that wants to keep a specific agency person
after the agency relationship ends can set the column to null on that one row,
which turns it into an ordinary direct membership. The same column lets
client-side UI tell agency staff apart from the client's own members.

Add this column when you add the pattern, not after: retrofitting provenance
onto existing agency-derived memberships means guessing, row by row, which ones
were derived and which were granted directly.

### Cross-client work

There's no query that reads rows across an agency's clients in one call &mdash;
that's the fail-closed guarantee holding. Agency-level reporting or bulk
operations run `db.$forOrg(child.id)` once per child, with the child list looked
up on plain `db`:

```ts title="api/src/jobs/AgencyRollupReportJob/AgencyRollupReportJob.ts"
import { db } from 'src/lib/db'
import { jobs } from 'src/lib/jobs'

export const AgencyRollupReportJob = jobs.createJob({
  queue: 'default',
  perform: async (agencyOrgId: string) => {
    const children = await db.organization.findMany({
      where: { parentId: agencyOrgId },
    })

    const rows = []
    for (const child of children) {
      // highlight-next-line
      const childDb = db.$forOrg(child.id)
      const projects = await childDb.project.findMany()
      rows.push({ organization: child.name, projectCount: projects.length })
    }

    // ...persist or email the roll-up
  },
})
```

## 9. Pitfalls

A few mistakes the
[Ravion](https://www.ravion.com/blog/ultimate-guide-to-multi-tenant-saas-data-modeling)
and [Bullet Train](https://blog.bullettrain.co/teams-should-be-an-mvp-feature/)
articles this how-to draws on both call out, restated for Cedar:

- **Mixed auth methods per organization.** A user who signs up with a password
  and later logs in via an OAuth provider needs `getCurrentUser()` to resolve to
  the same `User` row (and therefore the same memberships) regardless of
  provider. This is app-owned auth wiring, not something the tenancy layer
  changes, but it's worth testing explicitly: an org owner who can't get back
  into their own organization because they used a different login method is a
  support ticket, not an edge case.
- **Assigning to users instead of memberships.** An `assigneeId` that references
  `User.id` instead of `Membership.id` breaks the moment you invite someone who
  hasn't signed up yet, and it silently reassigns work across every organization
  that user belongs to instead of just one. Assign to `Membership.id`.
- **Analytics group ids.** If you send events to an analytics tool, group by
  `organizationId`, not by `userId` or by `membershipId`. A `membershipId` group
  loses the ability to compare an organization's activity across its members;
  grouping by `userId` mixes activity from every organization that user is in
  into one bucket, which is exactly the cross-tenant leak the rest of this
  feature exists to prevent.
- **Cell tests for org-scoped components.** A component rendered in isolation
  has no matched route, so `useParams()` sees no `orgSlug`; a component that
  reads it and passes it to a generated `routes.*()` call fails route param
  validation in the test. Use `mockRouteParams({ orgSlug: 'acme' })` before
  `render()` &mdash; see [`mockRouteParams()`](../testing.md#mockrouteparams)
  in the testing docs.
