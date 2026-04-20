# gqlorm Phase 4.1: Auto-Generated Backend Resolvers via Codegen

## Summary

When `experimental.gqlorm.enabled = true` in `cedar.toml`, extend the existing
`generateGqlormArtifacts()` codegen to also produce a generated SDL file
(`api/src/graphql/__gqlorm__.sdl.ts`) containing GraphQL type definitions and
query resolvers for every non-hidden Prisma model that does **not** already have
a manually-written SDL file. This makes gqlorm truly end-to-end: no SDL files,
no service files needed for gqlorm-managed models.

---

## What's Already Implemented

| Area                                                                                                                         | Status      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `buildModelSchema()` – parses DMMF, applies `@gqlorm hide/show` + sensitivity heuristics, writes `.cedar/gqlorm-schema.json` | Done        |
| `configureGqlorm({ schema })` – frontend setup call, `queryBuilder.configure()`, `setSchema()`                               | Done        |
| `useLiveQuery((db) => db.post.findMany())` – generates GraphQL query with all visible scalar fields                          | Done        |
| Smoke tests for schema-aware field selection (body, createdAt)                                                               | Done        |
| **Backend auto-generated resolvers**                                                                                         | Not started |

The frontend generates correct queries, but the backend still requires
hand-written SDL + service files for every model. The `Post`, `User`, and
`Contact` models in the test projects all have manual SDLs and services.

---

## What This Step Implements

1. **Enriched DMMF field info collection** — alongside the existing
   `ModelSchema` (field names only), collect GraphQL types, nullability, and
   `@id` flags for each visible field.

2. **Existing-SDL detection** — scan `api/src/graphql/*.sdl.{ts,js}` for
   already-defined GraphQL type names; skip those models in the generated file
   to avoid merge conflicts.

3. **SDL file generation** — write `api/src/graphql/__gqlorm__.sdl.ts`
   containing:
   - GraphQL type definitions for each gqlorm-managed model
   - `findMany` (plural) and `findUnique` (singular with `id` argument) query
     fields, both with `@skipAuth` (auth model deferred to a follow-up)
   - Resolver functions that call `db.<model>.findMany({ select })` and
     `db.<model>.findUnique({ where: { id }, select })`, selecting only visible
     fields

4. **New `Todo` model** — added to both test projects (`local-testing-project-live`
   and `__fixtures__/test-project-live`) with **no** manual SDL or service file.
   The gqlorm codegen auto-generates the backend for it.

5. **New page + component** — `GqlormTodoPage` renders a `LiveTodos` component
   that uses `useLiveQuery((db) => db.todo.findMany())`.

6. **Seed data** — a few `Todo` records are seeded so the page has data to
   display.

7. **E2E Playwright tests** — verify the full pipeline: codegen → generated SDL
   → glob import → GraphQL server → `useLiveQuery` → rendered output.

---

## Architecture

```
                                  codegen (yarn dev startup)
                                           │
                    ┌──────────────────────┐│┌──────────────────────────┐
                    │  .cedar/             │││  api/src/graphql/        │
                    │  gqlorm-schema.json  ◄┤├►  __gqlorm__.sdl.ts     │
                    │  (field names)       │││  (types + resolvers)     │
                    └─────────┬────────────┘│└─────────┬────────────────┘
                              │             │          │
                    web side  │             │  api side│  glob import
                              ▼             │          ▼
                    configureGqlorm()       │  createGraphQLHandler({
                              │             │    sdls,  ← includes __gqlorm__
                              ▼             │    services,
                    useLiveQuery(           │    ...
                      db.todo.findMany()   │  })
                    )                       │          │
                              │             │          ▼
                              │             │  makeMergedSchema
                              │             │  merges __gqlorm__.sdl.ts
                              ▼             │  with user SDL files
                    GraphQL query ──────────┼──────────► resolvers
                    { todos { id title      │          call db.todo.findMany()
                      body done createdAt }}│
```

### Why codegen-generated SDL?

The generated `__gqlorm__.sdl.ts` is placed in `api/src/graphql/` — exactly
where Cedar's glob import (`src/graphql/**/*.sdl.{js,ts}`) already looks. This
means:

- **Zero changes to `createGraphQLHandler`** or the graphql-server package
- **Zero changes to the user's `graphql.ts`** function file
- The generated file flows through the existing `makeMergedSchema` pipeline
- Resolver functions import `db` from `src/lib/db`, following Cedar convention

The file is clearly marked as generated (header comment + `__` prefix) and
should be added to `.gitignore` in user projects. It is regenerated on every
codegen run.

---

## Detailed Changes

### `packages/internal/src/generate/gqlormSchema.ts`

#### New types

```ts
interface BackendFieldInfo {
  name: string
  graphqlType: string // e.g. "Int", "String", "DateTime", "Boolean"
  isRequired: boolean
  isId: boolean
}

interface BackendModelInfo {
  modelName: string // PascalCase, e.g. "Todo"
  camelName: string // camelCase, e.g. "todo"
  pluralName: string // plural camelCase, e.g. "todos"
  fields: BackendFieldInfo[]
  idField: BackendFieldInfo | undefined
}
```

#### New functions

- **`mapDmmfTypeToGraphql(type: string, kind: string): string`** — maps DMMF
  field types to GraphQL SDL types using the mapping table from the master plan.

- **`buildBackendModelInfo(dmmf)`** — iterates DMMF models applying the same
  visibility rules as `buildModelSchema()` (skip `@gqlorm hide`, sensitivity
  heuristics, etc.) but also collects type/nullability/id info. Returns
  `BackendModelInfo[]`.

- **`getExistingSdlTypeNames(graphqlDir: string): Set<string>`** — reads all
  `*.sdl.{ts,js}` files in the given directory, extracts GraphQL type names via
  regex (`/\btype\s+([A-Z]\w+)\s*\{/g`), and returns the set of names (minus
  `Query`, `Mutation`, `Subscription`).

- **`generateGqlormSdlContent(models: BackendModelInfo[]): string`** — produces
  the full TypeScript source for `__gqlorm__.sdl.ts`:
  - Header comment
  - `import { db } from 'src/lib/db'`
  - `export const schema = gql\`...\`` with type defs and query fields
  - `export const resolvers = { Query: { ... } }` with resolver functions

#### Modified function

- **`generateGqlormArtifacts()`** — after writing `gqlorm-schema.json` (unchanged),
  also calls `buildBackendModelInfo()`, `getExistingSdlTypeNames()`, filters
  out models with existing SDLs, and writes the generated SDL file via
  `generateGqlormSdlContent()`.

### `packages/internal/src/__tests__/gqlormSchema.test.ts`

New tests covering:

- `mapDmmfTypeToGraphql()` for all DMMF types
- `buildBackendModelInfo()` — field selection, id detection, type mapping
- `getExistingSdlTypeNames()` — extracts types from mock SDL content
- `generateGqlormSdlContent()` — output contains correct SDL + resolvers
- Integration test: `generateGqlormArtifacts()` produces the SDL file, skipping
  models that have existing SDLs in the fixture

### `local-testing-project-live/`

| File                                              | Change                                 |
| ------------------------------------------------- | -------------------------------------- |
| `api/db/schema.prisma`                            | Add `Todo` model                       |
| `scripts/seed.ts`                                 | Seed 3 Todo records                    |
| `web/src/components/LiveTodos/LiveTodos.tsx`      | New component using `useLiveQuery`     |
| `web/src/pages/GqlormTodoPage/GqlormTodoPage.tsx` | New page rendering `<LiveTodos />`     |
| `web/src/Routes.tsx`                              | Add `/gqlorm-todos` route              |
| `api/src/graphql/__gqlorm__.sdl.ts`               | Auto-generated by codegen (gitignored) |

**No `api/src/graphql/todos.sdl.ts` or `api/src/services/todos/` is created.**

### `__fixtures__/test-project-live/`

Mirror all changes from `local-testing-project-live/`.

### `tasks/test-project/rebuild-test-project-fixture.mts`

Add a step (after Prisma migration) that runs `yarn cedar generate` to ensure
the gqlorm codegen artifacts are present in the fixture.

### `tasks/smoke-tests/live/tests/liveQuery.spec.ts`

New tests:

- **`gqlorm auto-generated backend: todo list renders`** — navigates to
  `/gqlorm-todos`, verifies todo items are visible
- **`gqlorm auto-generated backend: todo fields are present`** — checks that
  all scalar fields (title, body, done, createdAt) are rendered

---

## DMMF Type → GraphQL SDL Type Mapping

| DMMF `type` | GraphQL SDL |
| ----------- | ----------- |
| `String`    | `String`    |
| `Int`       | `Int`       |
| `Float`     | `Float`     |
| `BigInt`    | `BigInt`    |
| `Boolean`   | `Boolean`   |
| `DateTime`  | `DateTime`  |
| `Json`      | `JSON`      |
| `Decimal`   | `String`    |
| `Bytes`     | `String`    |
| Enum        | `String`    |
| Unknown     | `String`    |

Nullability: `field.isRequired === true` → `Type!`, otherwise `Type`.

---

## Todo Model

```prisma
model Todo {
  id        Int      @id @default(autoincrement())
  title     String
  body      String?
  done      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

---

## Generated SDL Example

For the `Todo` model above (assuming `Post`, `User`, `Contact` already have
manual SDLs and are skipped):

```ts
// This file is auto-generated by Cedar gqlorm codegen.
// Do not edit — it will be overwritten on every codegen run.
// To hide a model from gqlorm, add /// @gqlorm hide in schema.prisma.

import { db } from 'src/lib/db'

export const schema = gql`
  type Todo {
    id: Int!
    title: String!
    body: String
    done: Boolean!
    createdAt: DateTime!
  }

  type UserExample {
    id: Int!
    email: String!
    name: String
  }

  type Query {
    todos: [Todo!]! @skipAuth
    todo(id: Int!): Todo @skipAuth
    userExamples: [UserExample!]! @skipAuth
    userExample(id: Int!): UserExample @skipAuth
  }
`

export const resolvers = {
  Query: {
    todos: () => {
      return db.todo.findMany({
        select: {
          id: true,
          title: true,
          body: true,
          done: true,
          createdAt: true,
        },
      })
    },
    todo: (_root: unknown, { id }: { id: number }) => {
      return db.todo.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          body: true,
          done: true,
          createdAt: true,
        },
      })
    },
    userExamples: () => {
      return db.userExample.findMany({
        select: { id: true, email: true, name: true },
      })
    },
    userExample: (_root: unknown, { id }: { id: number }) => {
      return db.userExample.findUnique({
        where: { id },
        select: { id: true, email: true, name: true },
      })
    },
  },
}
```

---

## Auth Model

This step uses `@skipAuth` on all generated queries. The full auth model
(`requireAuth`, `userId` scoping, `organizationId` membership filtering)
described in the master plan is deferred to a follow-up step. The `@skipAuth`
choice keeps this step testable without authentication infrastructure.

---

## Deferred to Follow-Up Steps

- `@requireAuth` + userId scoping + organization membership filtering
- `web-gqlorm-models.d.ts` type declarations (Phase 1.2 / Phase 3)
- Watch mode for Prisma schema changes (Phase 1.3)
- Mutation auto-generation (`create`, `update`, `delete`)
- Proper pluralization (currently just appends `s`)

---

## Testing

### Unit Tests

```
yarn test packages/internal
```

Tests in `packages/internal/src/__tests__/gqlormSchema.test.ts`:

- Type mapping correctness
- Backend model info extraction
- Existing SDL type detection
- Generated SDL content verification
- Integration test with test-project-live fixture

### E2E Playwright Tests

```
CEDAR_TEST_PROJECT_PATH=local-testing-project-live yarn playwright test tasks/smoke-tests/live/tests/liveQuery.spec.ts
```

New test cases:

- `gqlorm auto-generated backend: todo list renders`
- `gqlorm auto-generated backend: todo fields are present`

### Manual Verification

1. `cd local-testing-project-live && yarn dev`
2. Navigate to `http://localhost:8910/gqlorm-todos`
3. Verify todo items render with title, body, done status, and createdAt
4. Open GraphiQL at `http://localhost:8911/graphql`
5. Run `{ todos { id title body done createdAt } }` — should return data
6. Run `{ todo(id: 1) { id title body done createdAt } }` — should return one record
