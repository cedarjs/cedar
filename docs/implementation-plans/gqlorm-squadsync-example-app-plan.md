# SquadSync Example App — gqlorm Demo

## Overview

**SquadSync** is a small team task board app designed to give Cedar users a
quick, realistic sense of what gqlorm can do in a normal application.

The example focuses on the parts of gqlorm that are easiest to understand and
most immediately useful:

- **Auto-generated backend for straightforward models** — `Task` and
  `SavedFilter` get GraphQL queries and basic singular CRUD mutations with zero
  hand-written SDL/service files
- **Auth scoping by convention** — `Task.organizationId` scopes reads and writes
  through `Organization` + `Membership`, while `SavedFilter.userId` scopes
  private records to the current user
- **Safe generated mutations** — `SavedFilter.userId` is implicit in generated
  mutation resolvers, and `Task.organizationId` is always membership-validated
- **Sensitivity heuristics** — `User.hashedPassword` and `salt` are auto-hidden
  from generated gqlorm output
- **Live queries** — the task board and saved filters update in real time via
  `useLiveQuery`
- **Schema-aware field selection** — `useLiveQuery` auto-selects all visible
  scalar fields
- **Type safety** — model autocomplete on `db.`, inferred scalar-only return
  types

This app intentionally mixes **gqlorm-managed models** with **hand-written Cedar
GraphQL**. `Task` and `SavedFilter` are managed by gqlorm. `Organization`,
`User`, and `Membership` stay hand-written because they carry app-specific auth
and team-management behavior. The result shows the intended adoption path: use
gqlorm for the boring, predictable CRUD surface, and keep custom GraphQL for
custom behavior.

**Naming choices:** The default gqlorm convention expects an `Organization`
model and a `Membership` join table with `userId` / `organizationId` fields. The
schema below uses exactly these defaults, so no `cedar.toml` overrides are
needed.

---

## Acceptance criteria

The example app succeeds if it demonstrates that a Cedar user can:

1. Define Prisma models and expose them to GraphQL without hand-writing SDLs or
   services for those models
2. Read gqlorm-managed models from the web side using typed `useLiveQuery`
   access such as `db.task.findMany(...)` and `db.savedFilter.findMany(...)`
3. Use gqlorm-managed models without manually specifying field selections
4. Rely on convention-based auth scoping:
   - `Task` data is constrained by organization membership
   - `SavedFilter` data is constrained by `currentUser.id`
5. Perform basic writes with generated singular CRUD mutations
6. Trust generated mutations to apply safe ownership defaults:
   - `SavedFilter.userId` is assigned implicitly from auth context
   - `Task.organizationId` is validated against membership
7. Mix gqlorm-managed and hand-written GraphQL in the same Cedar app
8. Verify that sensitive fields like `hashedPassword` and `salt` never become
   queryable

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client" // Prisma v7
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String @id @default(cuid())
  email          String @unique
  fullName       String

  /// @gqlorm hide
  hashedPassword String

  /// @gqlorm hide
  salt String

  // gqlorm auto-hides these by heuristic (no directive needed):
  // resetToken, resetTokenExpiresAt would be auto-hidden too

  memberships  Membership[]
  assignedTasks Task[]      @relation("TaskAssignee")
  savedFilters SavedFilter[] @relation("SavedFilterOwner")
}

// Default gqlorm convention: model named "Organization" with a
// "Membership" join table using "userId" / "organizationId" fields.
// No cedar.toml overrides needed.
model Organization {
  id           Int          @id @default(autoincrement())
  name         String
  slug         String       @unique
  memberships  Membership[]
  tasks        Task[]
  savedFilters SavedFilter[]
}

model Membership {
  id             Int          @id @default(autoincrement())
  role           String       @default("member") // "admin" | "member"
  userId         String
  organizationId Int
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])

  @@unique([userId, organizationId])
}

// --- gqlorm-managed models (no SDL, no service) ---

model Task {
  id             Int       @id @default(autoincrement())
  title          String
  description    String?
  status         String    @default("todo")   // "todo" | "in_progress" | "done"
  priority       String    @default("medium") // "low" | "medium" | "high"
  assigneeId     String?
  organizationId Int
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  assignee     User?        @relation("TaskAssignee", fields: [assigneeId], references: [id])
  organization Organization @relation(fields: [organizationId], references: [id])
}

model SavedFilter {
  id             Int       @id @default(autoincrement())
  name           String
  status         String?
  priority       String?
  assigneeId     String?
  userId         String
  organizationId Int
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  user         User         @relation("SavedFilterOwner", fields: [userId], references: [id])
  organization Organization @relation(fields: [organizationId], references: [id])
  assignee     User?        @relation("SavedFilterAssignee", fields: [assigneeId], references: [id])
}
```

---

## Architecture

```
User project (monorepo workspace: api/ + web/)

┌─────────────────────────────────────────────────────────────────────┐
│ SHARED                                                              │
│  cedar.toml — experimental.gqlorm { enabled = true }                │
│  api/db/schema.prisma — single source of truth                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ HAND-WRITTEN (traditional SDL + services)                           │
│  api/src/graphql/organizations.sdl.ts                               │
│  api/src/services/organizations/organizations.ts                    │
│  api/src/graphql/users.sdl.ts                                       │
│  api/src/services/users/users.ts            — auth + profile        │
│  api/src/graphql/memberships.sdl.ts                                 │
│  api/src/services/memberships/memberships.ts                        │
│                                                                     │
│  api/src/lib/db.ts                                                  │
│  api/src/lib/auth.ts — auth provider + currentUser resolver         │
│  api/src/functions/graphql.ts                                       │
│  api/src/functions/auth.ts — dbAuth endpoints (login/signup/logout) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ GQLORM-MANAGED (zero files in api/src/)                             │
│                                                                     │
│  .cedar/gqlorm/backend.ts — auto-generated queries + CRUD           │
│  .cedar/gqlorm-schema.json — auto-generated                         │
│  .cedar/types/includes/web-gqlorm-models.d.ts — auto-generated      │
│                                                                     │
│  Codegen reads Prisma DMMF → applies visibility rules →             │
│    skips Organization/User/Membership (existing SDL detected) →     │
│    generates Task + SavedFilter types, queries, and mutations       │
│                                                                     │
│  Babel plugin injects into graphql.ts at build time                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ WEB (React + gqlorm frontend)                                       │
│                                                                     │
│  web/src/App.tsx — configureGqlorm({ schema }) call                 │
│  web/src/Routes.tsx                                                 │
│                                                                     │
│  Pages:                                                             │
│    LoginPage / SignupPage — auth (dbAuth)                           │
│    DashboardPage — organization list (hand-written SDL)             │
│    OrgPage — org-scoped task board + private saved filters          │
│                                                                     │
│  Components:                                                        │
│    OrgHeader — org name + member summary                            │
│    TaskBoard — useLiveQuery for tasks, real-time updates            │
│    TaskComposer — create task via generated mutation                │
│    TaskCard — display task + status/priority update                │
│    SavedFilterList — user's saved filters for this org              │
│    SavedFilterForm — create/update/delete saved filters             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ DATA FLOW                                                           │
│                                                                     │
│  OrgPage mounts:                                                    │
│    1. Hand-written org query resolves organization by slug          │
│       and enforces membership before rendering the page             │
│                                                                     │
│    2. useLiveQuery((db) => db.task.findMany({                       │
│         where: { organizationId },                                  │
│         orderBy: { createdAt: 'desc' },                             │
│       }))                                                           │
│       → generates GraphQL query with all visible Task scalar fields │
│       → backend auto-scopes by organization membership              │
│       → returns GqlormScalar.Task[]                                 │
│                                                                     │
│    3. useLiveQuery((db) => db.savedFilter.findMany({                │
│         where: { organizationId },                                  │
│         orderBy: { createdAt: 'desc' },                             │
│       }))                                                           │
│       → auto-selects visible scalar fields                          │
│       → backend auto-scopes by current user                         │
│       → returns only the signed-in user's filters for that org      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Generated mutation behavior

For gqlorm-managed models in this example, gqlorm generates basic singular CRUD
mutations:

- `createTask`, `updateTask`, `deleteTask`
- `createSavedFilter`, `updateSavedFilter`, `deleteSavedFilter`

The generated mutations should follow these rules:

- Input types include writable scalar fields only
- Server-managed fields like `id`, `createdAt`, and `updatedAt` are excluded
- For user-scoped models, auth-owned fields like `userId` are excluded from
  client input and filled from `currentUser`
- For organization-scoped models, `organizationId` may be client-provided when
  needed, but it is always validated against the current user's memberships
- Update and delete resolvers scope records before mutating them, rather than
  mutating first and checking later

These mutations are intended for straightforward CRUD. Custom workflows and
business-specific actions should still use hand-written SDLs and services.

---

## Implementation Steps

### Step 1: Scaffold the Cedar app

```
yarn create cedar-app squadsync
cd squadsync
yarn install
```

Select TypeScript and dbAuth.

### Step 2: Enable gqlorm in `cedar.toml`

The schema below uses the default model/field names (`Organization`,
`Membership`, `userId`, `organizationId`), so no naming overrides are needed.

```toml
[experimental.gqlorm]
enabled = true
```

### Step 3: Replace `schema.prisma`

Replace the default Prisma schema with the one in the
[Prisma Schema](#prisma-schema) section above.

Run:

```
yarn prisma migrate dev --name init
```

### Step 4: Generate gqlorm artifacts

```
yarn cedar generate
```

This produces:

- `.cedar/gqlorm-schema.json` — visible scalar field metadata for gqlorm-aware
  frontend queries
- `.cedar/gqlorm/backend.ts` — auto-generated query and mutation SDL + resolvers
  for `Task` and `SavedFilter`
- `.cedar/types/includes/web-gqlorm-models.d.ts` — `GqlormScalar.Task`,
  `GqlormScalar.SavedFilter`, `GqlormScalar.Organization`, and
  `GqlormScalar.User` (visible fields only) augmenting `GqlormTypeMap`

Verify the generated backend skips models with existing SDLs. `Organization`,
`User`, and `Membership` stay hand-written, while `Task` and `SavedFilter` get
full generated query + basic CRUD support.

### Step 5: Configure gqlorm in `App.tsx`

```tsx
// web/src/App.tsx
import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import schema from '../../.cedar/gqlorm-schema.json'

configureGqlorm({ schema })
```

Must be called before any `useLiveQuery` invocation. Place it at the top of the
component tree, before `<RedwoodProvider>`.

### Step 6: Hand-write SDLs + services for Organization, User, Membership

These follow standard Cedar conventions. No gqlorm-specific changes.

#### `api/src/graphql/organizations.sdl.ts`

```ts
export const schema = gql`
  type Organization {
    id: Int!
    name: String!
    slug: String!
    memberships: [Membership!]!
    tasks: [Task!]!
  }

  type Query {
    organizations: [Organization!]! @requireAuth
    organization(slug: String!): Organization @requireAuth
  }
`
```

The organization resolvers should enforce membership so a signed-in user can
only resolve organizations they belong to.

#### `api/src/graphql/users.sdl.ts`

```ts
export const schema = gql`
  type User {
    id: String!
    email: String!
    fullName: String!
    memberships: [Membership!]!
  }

  type Query {
    currentUser: User @requireAuth
    user(id: String!): User @requireAuth
  }
`
```

Note: `hashedPassword` and `salt` are absent from the hand-written `User` SDL.
Even though gqlorm would auto-hide them for generated output, the manual SDL
should exclude them too.

#### `api/src/services/organizations/organizations.ts`

Standard resolver with `requireAuth`, plus membership filtering for list/detail
queries.

#### `api/src/services/users/users.ts`

Standard resolver returning `context.currentUser` or looking up by id.

#### `api/src/services/memberships/memberships.ts`

Standard service for membership lookups and any membership-management behavior
needed by the app.

### Step 7: Write the web pages and components

Use traditional Cedar data fetching for the hand-written organization layer, and
`useLiveQuery` for gqlorm-managed data.

#### `web/src/pages/OrgPage/OrgPage.tsx`

This page should:

- resolve the organization by slug through the hand-written GraphQL API
- render the org name and membership-aware shell
- pass `organization.id` into gqlorm-powered components
- show both the shared task board and the signed-in user's saved filters

A natural composition is:

- `OrgHeader`
- `TaskComposer`
- `TaskBoard`
- `SavedFilterList`
- `SavedFilterForm`

#### `web/src/components/TaskBoard/TaskBoard.tsx`

Use `useLiveQuery` to fetch tasks for the current organization:

```tsx
import { useLiveQuery } from '@cedarjs/gqlorm'

interface TaskBoardProps {
  organizationId: number
}

export const TaskBoard = ({ organizationId }: TaskBoardProps) => {
  const { data: tasks, loading } = useLiveQuery((db) =>
    db.task.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    })
  )

  if (loading) {
    return <div>Loading tasks...</div>
  }

  return (
    <div className="task-board">
      {tasks?.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  )
}
```

Key gqlorm behavior:

- `db.task.findMany({ where: { organizationId } })` generates a query that
  selects every visible Task scalar field except relations
- no explicit `select` is needed
- backend resolvers further constrain results to organizations the current user
  belongs to

#### `web/src/components/SavedFilterList/SavedFilterList.tsx`

Use `useLiveQuery` to fetch only the current user's saved filters for the org:

```tsx
import { useLiveQuery } from '@cedarjs/gqlorm'

interface SavedFilterListProps {
  organizationId: number
}

export const SavedFilterList = ({ organizationId }: SavedFilterListProps) => {
  const { data: filters, loading } = useLiveQuery((db) =>
    db.savedFilter.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    })
  )

  if (loading) {
    return <div>Loading saved filters...</div>
  }

  return (
    <div className="saved-filter-list">
      {filters?.map((filter) => (
        <div key={filter.id}>
          <strong>{filter.name}</strong>
        </div>
      ))}
    </div>
  )
}
```

Key gqlorm behavior:

- the caller only supplies `organizationId`
- the generated resolver additionally scopes by `userId = currentUser.id`
- the signed-in user sees only their own filters, even though no explicit
  `userId` appears in the frontend query

#### Task and filter mutations

Use generated CRUD mutations for straightforward record changes:

- `TaskComposer` calls generated `createTask`
- `TaskCard` calls generated `updateTask` and `deleteTask` as needed
- `SavedFilterForm` calls generated `createSavedFilter`, `updateSavedFilter`,
  and `deleteSavedFilter`

The frontend does not provide `userId` when creating or updating a
`SavedFilter`. The generated resolver fills it from the current auth context.

### Step 8: Add seed data

```ts
// scripts/seed.ts
import { db } from 'api/src/lib/db'

export default async () => {
  const alice = await db.user.create({
    data: {
      email: 'alice@example.com',
      fullName: 'Alice',
      hashedPassword: '...',
      salt: '...',
    },
  })

  const bob = await db.user.create({
    data: {
      email: 'bob@example.com',
      fullName: 'Bob',
      hashedPassword: '...',
      salt: '...',
    },
  })

  const squadA = await db.organization.create({
    data: { name: 'Squad A', slug: 'squad-a' },
  })

  const squadB = await db.organization.create({
    data: { name: 'Squad B', slug: 'squad-b' },
  })

  await db.membership.createMany({
    data: [
      { userId: alice.id, organizationId: squadA.id, role: 'admin' },
      { userId: bob.id, organizationId: squadB.id, role: 'member' },
    ],
  })

  const squadATask = await db.task.create({
    data: {
      title: 'Build the task board',
      description: 'Show gqlorm-powered live task data',
      status: 'in_progress',
      priority: 'high',
      organizationId: squadA.id,
      assigneeId: alice.id,
    },
  })

  await db.task.create({
    data: {
      title: 'Write onboarding notes',
      status: 'todo',
      priority: 'medium',
      organizationId: squadB.id,
      assigneeId: bob.id,
    },
  })

  await db.savedFilter.createMany({
    data: [
      {
        name: 'My active work',
        status: 'in_progress',
        userId: alice.id,
        organizationId: squadA.id,
        assigneeId: alice.id,
      },
      {
        name: 'Todo for Bob',
        status: 'todo',
        userId: bob.id,
        organizationId: squadB.id,
        assigneeId: bob.id,
      },
    ],
  })

  console.log(
    JSON.stringify(
      {
        seededTaskId: squadATask.id,
        seededOrgSlug: squadA.slug,
      },
      null,
      2
    )
  )
}
```

This seed data intentionally creates two users in different organizations so the
scoping behavior is easy to verify.

---

## What gqlorm handles vs what's manual

| Concern                              | Who owns it     | Details                                                |
| ------------------------------------ | --------------- | ------------------------------------------------------ |
| Task query SDL + resolvers           | **gqlorm**      | Auto-generated from Prisma schema                      |
| SavedFilter query SDL + resolvers    | **gqlorm**      | Auto-generated, `userId`-scoped                        |
| Task mutation SDL + resolvers        | **gqlorm**      | Generated singular CRUD                                |
| SavedFilter mutation SDL + resolvers | **gqlorm**      | Generated singular CRUD, `userId` implicit             |
| Task/SavedFilter field selection     | **gqlorm**      | Schema-aware, all visible scalars                      |
| User-scoped filter access            | **gqlorm**      | Convention: `userId` field detected                    |
| Org-scoped task access               | **gqlorm**      | Convention: `organizationId` via `Membership` join     |
| Ownership-safe generated writes      | **gqlorm**      | `userId` filled from auth, `organizationId` validated  |
| New simple model exposed to GraphQL  | **gqlorm**      | Add to `schema.prisma`, regenerate                     |
| `configureGqlorm()` setup            | Manual (1 line) | Import + call in `App.tsx`                             |
| Organization SDL + service           | Manual          | Standard Cedar SDL + resolver                          |
| User SDL + service                   | Manual          | Auth + profile, hand-written                           |
| Membership SDL + service             | Manual          | Join table operations                                  |
| Auth (login/signup)                  | Manual          | dbAuth or provider                                     |
| Custom workflows / domain actions    | Manual          | Use hand-written SDL + service when CRUD is not enough |

---

## What the user doesn't write

For the two gqlorm-managed models (`Task` and `SavedFilter`), the user never
creates:

- `api/src/graphql/tasks.sdl.ts`
- `api/src/graphql/savedFilters.sdl.ts`
- `api/src/services/tasks/tasks.ts`
- `api/src/services/savedFilters/savedFilters.ts`
- Resolver functions for `findMany`, `findUnique`, `create`, `update`, or
  `delete` on these models
- Explicit `select` clauses in `useLiveQuery` calls
- Manual ownership logic for `SavedFilter.userId`
- Manual membership validation logic for straightforward Task CRUD

The generated files in `.cedar/` are gitignored. The user's source tree has zero
gqlorm-generated files.

---

## Testing plan

### App-level validation

- Unauthenticated users visiting `/org/squad-a` are redirected to login
- Authenticated members of Squad A can:
  - load `/org/squad-a`
  - see the seeded Squad A task
  - see only their own saved filters for Squad A
  - create, update, and delete tasks through generated mutations
  - create, update, and delete saved filters through generated mutations
- Authenticated users who are not members of Squad A:
  - cannot resolve the org page successfully
  - do not receive Squad A task data
  - do not receive Squad A saved filter data
- Live updates cause the task board and saved filter list to refresh after
  mutation-driven changes
- Sensitive fields like `hashedPassword` do not exist in the GraphQL schema

### Unit tests (packages/gqlorm)

- `useLiveQuery((db) => db.task.findMany())` generates a query with all visible
  Task scalar fields and no relations
- `useLiveQuery((db) => db.savedFilter.findMany({ where: { organizationId } }))`
  includes the provided `where` argument in the generated query
- `configureGqlorm({ schema })` with the SquadSync schema applies field
  selection correctly
- Generated mutation inputs exclude server-managed fields
- Sensitivity heuristics exclude `hashedPassword` and `salt` from `User` schema
  metadata

### Unit tests (packages/internal)

- `generateGqlormArtifacts()` with SquadSync's `schema.prisma` fixture:
  - Output contains `Task` and `SavedFilter` model entries
  - Output does NOT contain generated backend ownership for `Organization`,
    `User`, or `Membership` because existing SDL detection skips them
  - Output for `User` excludes `hashedPassword` and `salt`
  - `.cedar/gqlorm/backend.ts` contains generated query and singular CRUD
    mutation support
  - Generated `GqlormDb` interface has `task.findMany`, `task.findUnique`,
    `savedFilter.findMany`, and `savedFilter.findUnique`

### Backend auth scoping tests

- `db.task.findMany({ where: { organizationId } })` merges membership scoping:
  - `where` becomes
    `AND: [{ organizationId }, { organizationId: { in: [userOrgIds] } }]`
- `createTask` validates that the provided `organizationId` belongs to one of
  the current user's organizations
- `updateTask` and `deleteTask` scope records before mutating them
- `db.savedFilter.findMany({ where: { organizationId } })` merges user scoping:
  - `where` becomes `AND: [{ organizationId }, { userId: currentUser.id }]`
- `createSavedFilter` injects `userId: currentUser.id` and never trusts a
  client-provided user id
- `updateSavedFilter` and `deleteSavedFilter` scope records before mutating them
- Membership itself is exempt from org-scoping to avoid circular dependency

### E2E / Playwright tests

- **Unauthenticated:** visiting `/org/squad-a` redirects to login
- **Authenticated as Alice (member of Squad A):**
  - `/org/squad-a` shows the seeded Squad A task
  - `/org/squad-a` shows Alice's saved filter for Squad A
  - creating a task causes the task board to update live
  - creating a saved filter causes the filter list to update live
- **Authenticated as Bob (not a member of Squad A):**
  - `/org/squad-a` does not reveal Squad A details or data
  - gqlorm task queries scoped to Squad A return no rows
  - gqlorm saved filter queries scoped to Squad A return no rows
- **Sensitive fields:** GraphQL query attempts against `hashedPassword` fail
  because the field does not exist in the schema

---

## What this enables

Once SquadSync is running:

1. **Add a new model** — e.g. `Label` with `name`, `color`, and
   `organizationId`. Add it to `schema.prisma`, regenerate, and it becomes
   queryable with generated CRUD and typed frontend access.

2. **Change a field** — rename `priority` to `urgency` on `Task`. Regenerate.
   Frontend queries automatically request `urgency` instead of `priority`.
   TypeScript catches any missed component references.

3. **Toggle field visibility** — add `/// @gqlorm hide` to `description` on
   `Task`. The field disappears from the generated schema and from auto-selected
   frontend queries.

4. **Add a private per-user model** — e.g. `BoardPreference` with `userId`.
   Regenerate, and it inherits the same user-scoped convention as `SavedFilter`.

5. **Keep custom logic custom** — if the app later needs `archiveCompletedTasks`
   or `inviteMemberByEmail`, those stay hand-written while simple model CRUD
   remains generated.

This is the main value proposition for Cedar users: gqlorm removes repetitive
GraphQL boilerplate for predictable models without forcing the whole app into a
single abstraction.

