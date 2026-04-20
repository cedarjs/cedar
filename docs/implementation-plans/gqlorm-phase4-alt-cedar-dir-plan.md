# gqlorm Phase 4 (Alternative): Auto-Generated Backend — `.cedar/` Output with Framework Injection

## Summary

This is an alternative to the original Phase 4.1 plan. The goals are identical —
auto-generate GraphQL type definitions and resolvers for gqlorm-managed Prisma
models — but this plan enforces Cedar's rule that **continuously-regenerated code
must live in `.cedar/`, never in user-managed source directories**.

The original plan writes `api/src/graphql/__gqlorm__.sdl.ts` directly into the
user's source tree. This alternative generates the same content into
`.cedar/gqlorm/backend.ts` and has the framework inject it programmatically at
build time via a Babel plugin.

---

## Design Constraints

1. **No generated files in `api/src/` or `web/src/`.** Only one-off scaffolds
   (owned by the developer after generation) may live there.
2. **Prisma v7 only.** No backward-compatibility with Prisma v6 or earlier.
3. **`db` is exported from `api/src/lib/db.ts`.** This is the canonical Prisma
   client instance shared by all backend code.
4. **Minimal user-facing setup.** Ideally zero changes to existing files; at
   most, a one-line addition to `graphql.ts` added by the gqlorm setup
   generator.

---

## Alternatives Considered

### A. Generate a full `createSchema(...)` call instead of SDL

graphql-yoga's `createSchema({ typeDefs, resolvers })` is a thin convenience
wrapper around `@graphql-tools/schema`'s `makeExecutableSchema()` — the same
function Cedar's `makeMergedSchema` already uses internally. Generating a
pre-built `GraphQLSchema` object would then require a _second_ merge step
(`mergeSchemas` or `stitchSchemas`) to combine it with the user's schema,
adding complexity with no functional benefit.

The SDL + resolvers format (`{ schema: DocumentNode, resolvers: object }`) is
the native currency of Cedar's `SdlGlobImports` pipeline. Keeping the generated
output in this shape means zero changes to `makeMergedSchema` and natural
compatibility with Cedar's directive system, OpenTelemetry instrumentation, and
future tooling.

**Verdict:** No benefit over SDL generation. SDL format is preferred.

### B. Separate `/gqlorm` endpoint with its own Yoga server

A dedicated endpoint (e.g., `POST /gqlorm`) running a standalone, minimal Yoga
server would provide total isolation from the user's GraphQL setup.

**Pros:**

- Complete isolation — gqlorm can never interfere with user-authored SDL types
- Simpler server (no directives, no service auto-wiring, fewer plugins)
- No changes to `createGraphQLHandler` or `makeMergedSchema`
- Can evolve independently

**Cons:**

- `useLiveQuery` currently uses Apollo Client's `useQuery`, which is configured
  with a single GraphQL endpoint link. Routing gqlorm queries to `/gqlorm`
  requires either a `split` link or a separate Apollo Client instance.
- Two Yoga servers running in the same process (more memory, duplicate plugin
  stacks, separate CORS and auth context handling)
- Users cannot explore gqlorm types alongside their own types in GraphiQL
- gqlorm types cannot be composed with user-authored types (e.g., a user cannot
  add a custom field resolver to a gqlorm-generated type)
- Health checks and readiness probes need to cover both endpoints

**Verdict:** Viable as a future evolution if gqlorm becomes fully self-contained,
but premature at this stage. The web-side complexity and loss of composability
outweigh the isolation benefit. Worth revisiting if/when gqlorm introduces
mutations, subscriptions, or its own auth model that diverges from Cedar's
directive system.

### C. Codegen to `.cedar/` + framework injection (recommended)

Generate the backend artifacts into `.cedar/gqlorm/backend.ts` using a **factory
function pattern** (no static `db` import). A Babel plugin injects the generated
module as a static import into `api/src/functions/graphql.ts` at build time and
merges it into the `sdls` map before `makeMergedSchema` runs.

**Pros:**

- All generated code stays in `.cedar/` — no files in user-managed directories
- Flows through the existing `makeMergedSchema` pipeline unchanged
- gqlorm types are composable with user-authored types
- Single `/graphql` endpoint — GraphiQL shows everything
- The factory function pattern cleanly solves the `db` import problem without
  path aliases, relative imports, or duplicate Prisma client instances
- The generated `GqlormDb` interface contains only visible models and fields —
  no hidden, sensitive, or `@gqlorm hide` fields appear in the type surface

**Cons:**

- Requires a new Babel build plugin (analogous to the existing
  `babel-plugin-redwood-import-dir`), though it follows a well-established
  Cedar pattern

**Verdict: Recommended.** This approach honors the `.cedar/` rule, requires
minimal user-facing changes, and integrates cleanly with the existing
architecture.

---

## Architecture

```
                                codegen (yarn dev startup)
                                         │
                  ┌──────────────────────┐│┌───────────────────────────────┐
                  │  .cedar/             │││  .cedar/gqlorm/               │
                  │  gqlorm-schema.json  ◄┤├►  backend.ts                  │
                  │  (field names)       │││  (factory fn: types+resolvers)│
                  └─────────┬────────────┘│└─────────┬─────────────────────┘
                            │             │          │
                  web side  │             │  api side│  Babel plugin (build time)
                            ▼             │          ▼
                  configureGqlorm()       │  api/src/functions/graphql.ts
                            │             │  ← plugin injects at build time:
                            ▼             │    import * as __gqlorm_sdl__
                  useLiveQuery(           │      from '../../../.cedar/gqlorm/backend'
                    db.todo.findMany()   │    import { db as __gqlorm_db__ }
                  )                       │      from 'src/lib/db'
                            │             │    sdls = { ...sdls, __gqlorm__:
                            │             │      { schema: __gqlorm_sdl__.schema,
                            │             │        resolvers: __gqlorm_sdl__
                            │             │          .createGqlormResolvers(
                            │             │            __gqlorm_db__) } }
                            │             │          │
                            │             │          ▼
                            │             │  makeMergedSchema
                            │             │  merges __gqlorm__ with user SDLs
                            ▼             │          │
                  GraphQL query ──────────┼──────────► resolvers
                  { todos { id title      │          call db.todo.findMany()
                    body done createdAt }}│
```

### Why a factory function, and why no `db` import in `backend.ts`?

**The Babel alias resolution problem.** The api-side Babel config uses
`babel-plugin-module-resolver` with `cwd: 'packagejson'`, meaning alias values
like `src: './src'` resolve relative to the directory of the **nearest
`package.json`**. For files inside `api/src/`, that is `api/package.json` →
`src` = `api/src`. For files inside `.cedar/`, there is no `api/package.json`
in the parent chain — the nearest one is the **project root `package.json`** —
so `src` resolves to `<project-root>/src`, which does not exist. Both
`import { db } from 'src/lib/db'` and
`import { PrismaClient } from 'api/db/generated/prisma/client.mts'` would fail
at build time from `.cedar/`.

**The Prisma v7 client location.** In Prisma v7, `@prisma/client` in
`node_modules` is an empty compatibility shim with no real types. The actual
generated client lives at `api/db/generated/prisma/client.mts` (see the
`generator client` block in `api/db/schema.prisma`), which is gitignored and
not accessible via a path alias from outside `api/`. So
`import type { PrismaClient } from '@prisma/client'` gives no useful types, and
importing from the generated path directly hits the alias resolution problem
above.

**The hidden fields problem.** Even if `PrismaClient` were reachable, using it
as the parameter type for `createGqlormResolvers` would expose the full Prisma
type surface — all models including those marked `/// @gqlorm hide`, and all
fields including those suppressed by sensitivity heuristics. This contradicts
the visibility rules that gqlorm enforces.

**The solution: a generated `GqlormDb` interface.** At codegen time, the same
DMMF parse that produces `gqlorm-schema.json` also generates a minimal
`GqlormDb` interface scoped to exactly the visible models and the two operations
(`findMany`, `findUnique`) that the generated resolvers use. No imports needed —
the interface is emitted inline in `backend.ts`. Hidden and sensitive fields are
simply absent from it.

The factory function keeps `backend.ts` free of any project-path imports.
Instead, the Babel plugin injects the `db` import into
`api/src/functions/graphql.ts`, where the `src/` alias resolves correctly, and
passes it as an argument:

```ts
// injected into graphql.ts by the Babel plugin:
import { db as __gqlorm_db__ } from 'src/lib/db'
// ...
sdls = {
  ...sdls,
  __gqlorm__: {
    schema: __gqlorm_sdl__.schema,
    resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
  },
}
```

`backend.ts` itself only imports `gql` from `graphql-tag` — a regular npm
package resolvable from any directory — and defines all types inline.

**Could a root-level import map help?** Node.js supports an `"imports"` field
in `package.json` for package-internal import maps (entries must start with
`#`). TypeScript already honours these with `"moduleResolution": "node16"`, so
TypeScript type-checking would work. The gap is Babel: `babel-plugin-module-resolver`
does not currently read Node.js import maps, so a separate Babel plugin would be
needed to resolve `#cedar-db` → `./api/src/lib/db.ts` at build time. This is a
promising direction for Cedar to explore as a general cross-boundary import
mechanism, but it is new infrastructure that does not yet exist. For the current
plan the factory function + Babel inject approach is the right choice — it
requires no new infrastructure and follows an already-established Cedar pattern.

---

## Detailed Changes

### 1. Codegen: `packages/internal/src/generate/gqlormSchema.ts`

#### Types (same as original plan)

```ts
interface BackendFieldInfo {
  name: string
  graphqlType: string // "Int", "String", "DateTime", "Boolean", etc.
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

#### Modified: `generateGqlormArtifacts()`

After writing `.cedar/gqlorm-schema.json` (unchanged), also:

1. Call `buildBackendModelInfo(dmmf)` to collect enriched model info.
2. Call `getExistingSdlTypeNames(graphqlDir)` to find models with existing
   manual SDLs.
3. Filter out models that already have manual SDL definitions.
4. Call `generateGqlormBackendContent(models)` to produce the backend module
   source.
5. **Write to `.cedar/gqlorm/backend.ts`** (not `api/src/graphql/`).

#### New: `generateGqlormBackendContent(models: BackendModelInfo[]): string`

Produces a TypeScript module with:

- A header comment marking it as auto-generated
- `import gql from 'graphql-tag'`
- A generated `GqlormDb` interface covering only visible models and fields — no
  `@gqlorm hide` models, no sensitivity-heuristic-hidden fields, no `@prisma/client`
  dependency
- `export const schema = gql\`...\`` with type definitions and query fields
- `export function createGqlormResolvers(db: GqlormDb)` returning a resolvers
  object

Example output for the `Todo` model (assuming `Post`, `User`, `Contact` already
have manual SDLs and are skipped):

```ts
// This file is auto-generated by Cedar gqlorm codegen.
// Do not edit — it will be overwritten on every codegen run.
// To hide a model from gqlorm, add /// @gqlorm hide in schema.prisma.

import gql from 'graphql-tag'

// Generated minimal interface — only visible models and fields, only the
// operations used by this file. No @gqlorm hide models, no sensitive fields.
// Scoped to avoid any dependency on the generated Prisma client path or
// @prisma/client (which is an empty shim in Prisma v7).
interface GqlormDb {
  todo: {
    findMany(args: {
      select: { id: true; title: true; body: true; done: true; createdAt: true }
    }): Promise<
      Array<{
        id: number
        title: string
        body: string | null
        done: boolean
        createdAt: Date
      }>
    >
    findUnique(args: {
      where: { id: number }
      select: { id: true; title: true; body: true; done: true; createdAt: true }
    }): Promise<{
      id: number
      title: string
      body: string | null
      done: boolean
      createdAt: Date
    } | null>
  }
}

export const schema = gql`
  type Todo {
    id: Int!
    title: String!
    body: String
    done: Boolean!
    createdAt: DateTime!
  }

  type Query {
    todos: [Todo!]! @skipAuth
    todo(id: Int!): Todo @skipAuth
  }
`

// db is passed in from graphql.ts by the Babel inject plugin, which imports it
// from 'src/lib/db' in a context where that alias resolves correctly.
export function createGqlormResolvers(db: GqlormDb) {
  return {
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
    },
  }
}
```

### 2. Babel build plugin: `packages/babel-config`

#### New: `babel-plugin-cedar-gqlorm-inject.ts`

This plugin follows the same pattern as the existing
`babel-plugin-redwood-graphql-options-extract` — it runs as a Babel override
targeting only `api/src/functions/graphql.ts`. It transforms the file
**at build time** (synchronous, no dynamic imports, no async startup cost).

When `experimental.gqlorm.enabled = true` in `cedar.toml` and
`.cedar/gqlorm/backend.{ts,js}` exists, the plugin:

1. Computes the relative path from `graphql.ts` to the generated backend file
   (always `../../../.cedar/gqlorm/backend` in a standard Cedar project).
2. Inserts two imports at the top of the file:
   ```ts
   import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'
   import { db as __gqlorm_db__ } from 'src/lib/db'
   ```
   The `src/lib/db` import is injected into `graphql.ts`'s scope — where the
   `src/` alias correctly resolves to `api/src/` — rather than into
   `backend.ts`, where it would not.
3. Finds the `createGraphQLHandler` call (same approach as
   `babel-plugin-redwood-graphql-options-extract`) and inserts this statement
   immediately before it:
   ```ts
   sdls = {
     ...sdls,
     __gqlorm__: {
       schema: __gqlorm_sdl__.schema,
       resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
     },
   }
   ```

#### Modified: `getApiSideBabelOverrides` (`packages/babel-config/src/api.ts`)

Add the new plugin to the existing `graphql.ts` override block alongside
`pluginRedwoodGraphqlOptionsExtract`:

```ts
{
  test: /.+api(?:[\\|/])src(?:[\\|/])functions(?:[\\|/])graphql\.(?:js|ts)$/,
  plugins: [
    pluginRedwoodGraphqlOptionsExtract,   // existing
    pluginCedarGqlormInject,              // new
  ],
},
```

`pluginCedarGqlormInject` is a no-op when gqlorm is disabled or the generated
backend file does not exist.

No changes to `GraphQLYogaOptions`, `createGraphQLYoga`, or
`createGraphQLHandler` are required.

### 3. Test project changes

#### `local-testing-project-live/` and `__fixtures__/test-project-live/`

| File                                              | Change                                 |
| ------------------------------------------------- | -------------------------------------- |
| `api/db/schema.prisma`                            | Add `Todo` model                       |
| `scripts/seed.ts`                                 | Seed 3 Todo records                    |
| `web/src/components/LiveTodos/LiveTodos.tsx`      | New component using `useLiveQuery`     |
| `web/src/pages/GqlormTodoPage/GqlormTodoPage.tsx` | New page rendering `<LiveTodos />`     |
| `web/src/Routes.tsx`                              | Add `/gqlorm-todos` route              |
| `.cedar/gqlorm/backend.ts`                        | Auto-generated by codegen (gitignored) |

**No `api/src/graphql/__gqlorm__.sdl.ts` is created.**
**No `api/src/services/todos/` is created.**

### 4. Existing-SDL detection

Same as the original plan: `getExistingSdlTypeNames(graphqlDir)` scans
`api/src/graphql/*.sdl.{ts,js}` for already-defined GraphQL type names and
skips those models in the generated file to avoid type conflicts.

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

## Auth Model

This step uses `@skipAuth` on all generated queries. The full auth model
(`requireAuth`, `userId` scoping, `organizationId` membership filtering)
described in the master plan is deferred to a follow-up step. The `@skipAuth`
choice keeps this step testable without authentication infrastructure.

---

## Migration Path from Original Phase 4.1

Since the original Phase 4.1 plan has already been implemented, migrating to
this alternative requires:

1. **Move the output path** in `generateGqlormArtifacts()` from
   `api/src/graphql/__gqlorm__.sdl.ts` to `.cedar/gqlorm/backend.ts`.
2. **Refactor the generated content**: remove `import { db } from 'src/lib/db'`
   from the generated file; replace `export const resolvers` with
   `export function createGqlormResolvers(db: GqlormDb)`; add the generated
   `GqlormDb` interface (scoped to visible models and fields only).
3. **Add `babel-plugin-cedar-gqlorm-inject`** to `packages/babel-config` and
   register it in the `graphql.ts` Babel override alongside
   `pluginRedwoodGraphqlOptionsExtract`.
4. **No changes needed** to `GraphQLYogaOptions`, `createGraphQLYoga`, or any
   test project's `graphql.ts`.
5. **Delete `api/src/graphql/__gqlorm__.sdl.ts`** from test projects and add
   `.cedar/gqlorm/` to `.gitignore` (unless already covered by existing rules).

---

## Deferred to Follow-Up Steps

- `@requireAuth` + userId scoping + organization membership filtering
- `web-gqlorm-models.d.ts` type declarations (Phase 1.2 / Phase 3)
- Watch mode for Prisma schema changes (Phase 1.3)
- Mutation auto-generation (`create`, `update`, `delete`)
- Proper pluralization (currently just appends `s`)
- Separate `/gqlorm` endpoint (revisit if gqlorm diverges significantly from
  Cedar's directive/auth system)
- Root-level import map (`"imports"` in `package.json`) as a general
  cross-boundary import mechanism for Cedar, which could eventually replace
  the `babel-plugin-module-resolver` alias approach

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
- Generated backend content verification — checks that the output:
  - Contains a `GqlormDb` interface with only visible fields
  - Does not contain any `import` of `@prisma/client` or `src/lib/db`
  - Exports `createGqlormResolvers(db: GqlormDb)` (factory function shape)
- Integration test with test-project-live fixture — verifies output lands in
  `.cedar/gqlorm/backend.ts`, not in `api/src/graphql/`

### Continuous Verification By the LLM Agent

1. `cd local-testing-project-live && yarn dev`
2. Use curl to query the backend with `{ todos { id title body done createdAt } }` — should return data
3. Use curl to query the backend with `{ todo(id: 1) { id title body done createdAt } }` — should return one record

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
6. Run `{ todo(id: 1) { id title body done createdAt } }` — should return one
   record
7. Verify that no `__gqlorm__.sdl.ts` file exists in `api/src/graphql/`
8. Verify that `.cedar/gqlorm/backend.ts` exists and contains the generated
   `GqlormDb` interface and `createGqlormResolvers` factory function
