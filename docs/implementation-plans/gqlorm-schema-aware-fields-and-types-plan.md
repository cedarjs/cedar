# gqlorm: Schema-Aware Field Selection, Type Safety, and Auto-Generated Backend

## Table of Contents

- [Overview](#overview)
- [Design Principles](#design-principles)
- [Architecture](#architecture)
  - [Frontend Pipeline](#frontend-pipeline)
  - [Backend Pipeline](#backend-pipeline)
- [Implementation Phases](#implementation-phases)
  - [Phase 1: Frontend — Build-Time ModelSchema Codegen](#phase-1-frontend--build-time-modelschema-codegen)
  - [Phase 2: Frontend — Explicit `configureGqlorm()` Setup](#phase-2-frontend--explicit-configuregqlorm-setup)
  - [Phase 3: Frontend — Type-Safe Return Values](#phase-3-frontend--type-safe-return-values)
  - [Phase 4: Backend — Auto-Generated Resolvers](#phase-4-backend--auto-generated-resolvers)
- [Prisma Schema Annotations](#prisma-schema-annotations)
- [Configuration](#configuration)
- [File Change Summary](#file-change-summary)
- [Open Questions](#open-questions)
- [Acceptance Criteria](#acceptance-criteria)

---

## Overview

Currently, when a user writes `useLiveQuery((db) => db.post.findMany())` with no
explicit `select`, the generated GraphQL query only requests the `id` field.
This happens because the `queryBuilder` singleton has no knowledge of what scalar
fields a model exposes. The result is a poor experience — users expect Prisma-like
behaviour where `findMany()` with no arguments returns all scalar fields.

This plan solves three closely related problems:

1. **Runtime field selection**: `db.post.findMany()` should automatically
   generate a GraphQL query requesting all scalar fields for the model, without
   requiring an explicit `select`.

2. **Type safety**: TypeScript types flowing through `useLiveQuery` should offer
   autocomplete for model names when writing `db.` and should infer a return type
   that accurately reflects only the scalar fields actually present in the
   response.

3. **Invisible backend**: gqlorm needs its own backend that is completely
   separate from Cedar's existing SDL + services pattern. The goal is to go
   straight from the Prisma schema to live, working resolvers with no SDL files,
   no service files, and no manual wiring required. Users who choose gqlorm
   should never need to think about the backend.

All three are solved with a single explicit setup call —
`configureGqlorm({ schema })` — placed once in app startup. No user-authored
configuration files are needed beyond `cedar.toml` and provider setup.

---

## Design Principles

1. **Prisma schema is the single source of truth.** The frontend `ModelSchema`,
   the backend resolvers, and all field visibility rules are derived from
   `schema.prisma`. This keeps every tier in sync automatically whenever the
   schema changes. New models are automatically picked up with no additional
   steps required.

2. **Scalar fields only, no relations by default.** `findMany()` with no
   arguments generates a query for scalar fields only, exactly matching Prisma's
   own default behaviour. Relation fields require an explicit `include` or
   `select`, preventing accidental over-fetching and unintended data exposure.

3. **The gqlorm backend is completely separate from the SDL + services backend.**
   The two can coexist in the same Cedar app. Users who adopt gqlorm are not
   required to write SDLs or services for the models they expose through it.
   Existing SDL-based types and resolvers are unaffected.

4. **Secure by default: sensitive fields are hidden automatically.** All
   auto-generated resolvers require authentication. Fields whose names match
   sensitivity heuristics (`password`, `secret`, `token`, `hash`, `salt`, `key`,
   etc.) are hidden from the generated API automatically — no configuration
   needed. If a model has a `userId` field, queries are automatically scoped to
   the current user's records. If a model belongs to an organization, gqlorm
   automatically scopes queries using the configured `Membership` model and the
   resource's `organizationId` field. The developer never has to do anything to
   be safe; they only have to act when they want to deviate.

5. **Field and model visibility live in `schema.prisma`, alongside the data they
   describe.** Prisma's triple-slash doc comments (`///`) are preserved verbatim
   in the DMMF as `model.documentation` and `field.documentation`. gqlorm reads
   these at codegen time and at server startup. Keeping visibility annotations
   co-located with the schema eliminates the need to maintain a separate config
   file and ensures the annotations evolve with the model they describe.

6. **Setup is explicit, not injected.** The app calls `configureGqlorm({ schema })`
   once at startup, importing the generated schema artifact directly. This avoids
   the complexity and fragility of Vite virtual-module injection and gives users
   full control over when and how gqlorm is initialized.

7. **All configuration lives in `schema.prisma` or `cedar.toml` — never a
   separate config file.** Field and model visibility are expressed as
   `/// @gqlorm` directives directly in `schema.prisma`. Structural runtime
   concerns that cannot be expressed in schema comments (specifically, the
   membership-based organization access convention) live in `cedar.toml`.
   Generated artifacts live in `.cedar/` and are gitignored.

---

## Architecture

### Frontend Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│  packages/internal: generateGqlormArtifacts()                │
│                                                              │
│  From Prisma DMMF:                                           │
│    - skip models marked   /// @gqlorm hide                   │
│    - collect scalar fields per model                         │
│    - for each field:                                         │
│        if /// @gqlorm hide          → skip, no warning       │
│        if /// @gqlorm show          → include, no warning    │
│        if name matches heuristics   → skip + emit warning    │
│        otherwise                    → include                │
│    - record field name, DMMF type, isRequired                │
│                                                              │
│  Output A: .cedar/gqlorm-schema.json                         │
│  Output B: .cedar/types/includes/web-gqlorm-models.d.ts      │
└──────────────────────────────────────────────────────────────┘
               │                         │
               ▼                         ▼
┌─────────────────────────┐  ┌──────────────────────────────────────────┐
│  User app startup       │  │  .cedar/types/includes/                  │
│  (e.g. App.tsx or       │  │  web-gqlorm-models.d.ts                  │
│   bootstrap file)       │  │                                          │
│                         │  │  declare namespace GqlormScalar {        │
│  import {               │  │    interface Post {                      │
│    configureGqlorm      │  │      id: number                          │
│  } from '@cedarjs/      │  │      title: string                       │
│  gqlorm/setup'          │  │      body: string                        │
│  import schema from     │  │      authorId: string                    │
│   '.cedar/gqlorm-       │  │      createdAt: string                   │
│   schema.json'          │  │    }                                     │
│                         │  │    // sensitive fields absent            │
│  configureGqlorm({      │  │    interface User {                      │
│    schema               │  │      id: string                          │
│  })                     │  │      email: string                       │
│                         │  │      fullName: string                    │
│                         │  │    }                                     │
│                         │  │  }                                       │
│                         │  │                                          │
│                         │  │  declare module                          │
│                         │  │   '@cedarjs/gqlorm/types/orm' {          │
│                         │  │    interface GqlormTypeMap {             │
│                         │  │      models: {                           │
│                         │  │        post: GqlormScalar.Post           │
│                         │  │        user: GqlormScalar.User           │
│                         │  │      }                                   │
│                         │  │    }                                     │
│                         │  │  }                                       │
│                         │  └──────────────────────────────────────────┘
│                         │                         │ TypeScript picks up automatically
└─────────────────────────┘                         ▼
               │              ┌──────────────────────────────────────────────────────────┐
               │              │  Browser / app bundle                                    │
               │              │                                                          │
               │              │  configureGqlorm({ schema }) called once at startup:      │
               │              │    → forwards to queryBuilder.configure({ schema })       │
               │              │                                                          │
               │              │  useLiveQuery((db) => db.post.findMany()) now generates:  │
               │              │    query findManyPost @live {                             │
               │              │      posts { id  title  body  authorId  createdAt }       │
               │              │    }                                                      │
               │              │                                                          │
               │              │  Return type inferred as GqlormScalar.Post[]              │
               │              └──────────────────────────────────────────────────────────┘
               ▼
```

### Backend Pipeline

```
App startup  (yarn dev / server boot)
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  api/src/functions/graphql.ts  (user-authored, unchanged)    │
│                                                              │
│  createGraphQLHandler({ sdls, services, ... })               │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  packages/graphql-server: createGraphQLHandler               │
│                                                              │
│  Checks getConfig().experimental.gqlorm.enabled              │
│  If true:                                                    │
│    buildGqlormSchema(db)                                     │
│      reads Prisma.dmmf.datamodel.models                      │
│        → field structure, types, nullability                 │
│        → model.documentation  (@gqlorm hide on model)       │
│        → field.documentation  (@gqlorm hide / show)         │
│      reads cedar.toml [experimental.gqlorm] section            │
│        → organizationModel, membershipModel convention         │
│      for each model (skip if @gqlorm hide):                  │
│        build type def                                        │
│          skip @gqlorm hide fields                            │
│          skip sensitive fields with no directive             │
│        build query fields                                    │
│        build resolver (requireAuth + implicit filters)       │
│    sdls['__gqlorm__'] = { schema, resolvers }                │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  makeMergedSchema  (existing, unchanged)                     │
│                                                              │
│  Merges all sdls entries including __gqlorm__                │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  GraphQL Yoga server                                         │
│                                                              │
│  Auto-generated query fields:                                │
│    posts: [Post!]!   — requireAuth + implicit userId filter  │
│                      + implicit organizationId filter        │
│    post(id: Int!): Post                                      │
│    users: [User!]!   — sensitive fields absent from type     │
│    ...                                                       │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Frontend — Build-Time ModelSchema Codegen

**Goal**: Parse the Prisma schema at codegen time — including `/// @gqlorm`
directives and field name heuristics — to produce a runtime `ModelSchema` and
ambient TypeScript declarations with hidden and sensitive fields excluded.

#### 1.1 Add `generateGqlormArtifacts()` to `packages/internal`

Create `packages/internal/src/generate/gqlormSchema.ts` with a single exported
function `generateGqlormArtifacts()`.

This function:

- Calls `getDMMF({ datamodelPath })` from `@prisma/internals`, passing the path
  to `api/db/schema.prisma` via `getPaths().api.dbSchema`. This parses the Prisma
  schema file without requiring the Prisma client to have been generated first,
  making it safe to run early in the codegen pipeline.
- Iterates over `dmmf.datamodel.models`.
- **Skips** any model whose `model.documentation` contains `@gqlorm hide`.
- Also skips the internal Cedar/Redwood migration model
  (`RW_DataMigration` / `Cedar_DataMigration`) if present.
- For each remaining model, collects only the fields where `field.kind ===
'scalar'` — this automatically excludes relation fields (`kind === 'object'`)
  and computed fields (`kind === 'unsupported'`). Enum fields (`kind === 'enum'`)
  are included and typed as `string`.
- For each candidate scalar field, applies the following visibility logic in
  order:
  1. If `field.documentation` contains `@gqlorm hide` → **exclude**, no warning.
  2. If `field.documentation` contains `@gqlorm show` → **include**, no warning.
  3. If the field name matches the sensitivity heuristic list (`password`,
     `secret`, `token`, `hash`, `salt`, `key`, and common variants) →
     **exclude**, and **emit a codegen warning** (see below).
  4. Otherwise → **include**, no warning.
- Builds two outputs from the visible field data:
  - A `Record<string, string[]>` mapping lowercase model name to visible scalar
    field name array (the runtime `ModelSchema`)
  - A richer structure mapping each field to its DMMF type and `isRequired` flag,
    used for TypeScript type generation in step 1.2

**Codegen warning for auto-hidden fields:**

For each field that is hidden by heuristic (rule 3 above), `generateGqlormArtifacts()`
prints a warning to stdout during `yarn dev` and `yarn build`:

```
[gqlorm] User.hashedPassword was automatically hidden because its name
appears sensitive. Add a directive to suppress this warning:

  /// @gqlorm hide   — to confirm it should stay hidden
  /// @gqlorm show   — to explicitly expose it
```

The warning is per-field, printed once per codegen run. It disappears as soon
as either directive is present. This creates a feedback loop that nudges
developers toward explicit intent without blocking their workflow.

**Example `ModelSchema` output for the test project** (with `hashedPassword`,
`salt`, `resetToken`, `resetTokenExpiresAt` auto-hidden by heuristic):

```json
{
  "post": ["id", "title", "body", "authorId", "createdAt"],
  "user": ["id", "email", "fullName", "roles"],
  "contact": ["id", "name", "email", "message", "createdAt"]
}
```

Writes the `Record<string, string[]>` to `.cedar/gqlorm-schema.json`.

#### 1.2 Generate the TypeScript declaration file

As part of the same `generateGqlormArtifacts()` call (reusing the visible field
data from step 1.1), write `.cedar/types/includes/web-gqlorm-models.d.ts`. Only
visible fields appear in the generated interfaces, so the frontend type surface
matches exactly what the backend returns.

**DMMF type → TypeScript type mapping:**

| DMMF `type` | Non-null TS | Nullable TS       |
| ----------- | ----------- | ----------------- |
| `String`    | `string`    | `string \| null`  |
| `Int`       | `number`    | `number \| null`  |
| `Float`     | `number`    | `number \| null`  |
| `BigInt`    | `bigint`    | `bigint \| null`  |
| `Boolean`   | `boolean`   | `boolean \| null` |
| `DateTime`  | `string`    | `string \| null`  |
| `Json`      | `unknown`   | `unknown \| null` |
| `Bytes`     | `string`    | `string \| null`  |
| `Decimal`   | `string`    | `string \| null`  |
| Enum        | `string`    | `string \| null`  |
| Unknown     | `unknown`   | `unknown \| null` |

`DateTime` maps to `string` (not `Date`) because GraphQL serializes date-time
values as ISO 8601 strings. This matches what actually arrives in the browser at
runtime and avoids a class of subtle bugs where code treats a string as a `Date`
object. `Decimal` and `Bytes` map to `string` for the same reason.

**Example generated file** (sensitive fields absent):

```ts
// Auto-generated by Cedar — do not edit
// Regenerated on every codegen run. Source: api/db/schema.prisma

declare namespace GqlormScalar {
  interface Post {
    id: number
    title: string
    body: string
    authorId: string
    createdAt: string
  }

  // hashedPassword, salt, resetToken, resetTokenExpiresAt are absent:
  // auto-hidden by sensitivity heuristic. Add /// @gqlorm hide to confirm,
  // or /// @gqlorm show to expose them.
  interface User {
    id: string
    email: string
    fullName: string
    roles: string | null
  }

  interface Contact {
    id: number
    name: string
    email: string
    message: string
    createdAt: string
  }
}

declare module '@cedarjs/gqlorm/types/orm' {
  interface GqlormTypeMap {
    models: {
      post: GqlormScalar.Post
      user: GqlormScalar.User
      contact: GqlormScalar.Contact
    }
  }
}
```

The file is placed in `.cedar/types/includes/` using the `web-*.d.ts` naming
convention, which causes it to be included by `web/tsconfig.json` automatically.

#### 1.3 Plug into the codegen pipeline

In `packages/internal/src/generate/generate.ts`:

- Call `generateGqlormArtifacts()` as part of `generateTypeDefs()`. It reads
  `schema.prisma` directly so it does not depend on the merged SDL being fresh
  first, but running it with the type def generation step keeps all ambient
  declaration generation together.

In `packages/internal/src/generate/watch.ts`:

- Add a watcher rule: when `api/db/schema.prisma` changes, re-run
  `generateGqlormArtifacts()`. This keeps the `ModelSchema` and scalar type
  declarations in sync during `yarn dev`. No web source file watching is needed
  for gqlorm — all visibility metadata lives in the schema.

---

### Phase 2: Frontend — Explicit `configureGqlorm()` Setup

**Goal**: The generated `ModelSchema` is applied to the `queryBuilder` singleton
via an explicit `configureGqlorm({ schema })` call placed once in app startup.
The user controls exactly when and how gqlorm is initialized.

#### 2.1 Add `configureGqlorm()` public API

Create a new entry point in `packages/gqlorm` that exposes a single setup
function:

```ts
// packages/gqlorm/src/setup.ts
import { queryBuilder } from './queryBuilder'
import type { ModelSchema } from './types'

export interface ConfigureGqlormOptions {
  schema: ModelSchema
}

export function configureGqlorm(options: ConfigureGqlormOptions): void {
  queryBuilder.configure({ schema: options.schema })
}
```

This is the **public setup API**. It wraps `queryBuilder.configure()` so that
users never need to import the internal `queryBuilder` singleton directly.

#### 2.2 User calls `configureGqlorm()` at app startup

In the user's app — typically in `App.tsx` or a dedicated bootstrap file — add
a single import and call:

```ts
import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import schema from '.cedar/gqlorm-schema.json'

configureGqlorm({ schema })
```

The call must happen before the first `useLiveQuery` invocation. Placing it at
the top of `App.tsx` (or in a module that `App.tsx` imports) satisfies this
requirement.

The flow is:

```
Prisma schema → .cedar/gqlorm-schema.json → user import →
configureGqlorm({ schema }) → queryBuilder.configure()
```

#### 2.3 `configure()` on `QueryBuilder`

In `packages/gqlorm/src/queryBuilder.ts`, add a public `configure()` method:

```ts
configure(options: Partial<QueryBuilderOptions>): void {
  this.#options = { ...this.#options, ...options }
  if (options.schema !== undefined) {
    this.#generator.setSchema(options.schema)
  }
}
```

In `packages/gqlorm/src/generator/graphqlGenerator.ts`, add `setSchema()`:

```ts
setSchema(schema: ModelSchema | undefined): void {
  this.#schema = schema
}
```

Both methods are idempotent and safe to call multiple times. These are the
internal implementation details behind `configureGqlorm()`.

#### 2.4 Test environment handling

In Jest and Vitest test environments, there is no need for virtual-module
aliases. Tests can handle gqlorm setup in one of three ways:

1. **Import a stubbed setup helper** that calls `configureGqlorm()` with a
   test-specific schema or an empty schema.
2. **Call `configureGqlorm({ schema: undefined })`** to skip schema-based
   configuration, keeping the existing `id`-only fallback.
3. **Skip setup entirely** and rely on the `id`-only fallback behaviour.

No Vite plugin or module aliasing is required for tests.

---

### Phase 3: Frontend — Type-Safe Return Values

**Goal**: `useLiveQuery((db) => db.post.findMany())` infers a return type of
`GqlormScalar.Post[]` — visible scalar fields only — and `db.` in the callback
offers model-name autocomplete.

#### 3.1 Model-name autocomplete — already working

Autocomplete for `db.post`, `db.user`, etc. already works through the existing
`all-gqlorm.d.ts` codegen chain and requires no changes:

```
.cedar/types/includes/all-gqlorm.d.ts
  → augments GqlormTypeMap { db: typeof db }
  → FrameworkDbClient = ModelDelegatesOnly<typeof db>
     (strips $connect, $disconnect, etc.)
  → useLiveQuery callback typed as (db: FrameworkDbClient) => ...
  → IDE autocompletes db.post, db.user, db.contact, ...
```

This should be verified in the test project as part of this work but no
implementation changes are required for it.

#### 3.2 Wire scalar types into `ModelDelegate` and `useLiveQuery`

The goal is for `db.post.findMany()` to return `Promise<GqlormScalar.Post[]>`
when `GqlormTypeMap.models` is populated, rather than the Prisma-native
`Promise<PrismaPost[]>` (which includes relation fields typed as non-optional and
sensitive fields that gqlorm intentionally hides).

In `packages/gqlorm/src/types/orm.ts`, add a utility type that resolves the
scalar type for a given model name, falling back to `unknown` when the codegen
has not yet run:

```ts
type ScalarTypeForModel<TModel extends string> = GqlormTypeMap extends {
  models: Record<TModel, infer TScalar>
}
  ? TScalar
  : unknown
```

Update `ModelDelegate<T>` so that all read operations return `T`:

```ts
export interface ModelDelegate<T> {
  findMany(args?: FindManyArgs<T>): Promise<T[]>
  findUnique(args: FindUniqueArgs<T>): Promise<T | null>
  findFirst(args?: FindFirstArgs<T>): Promise<T | null>
  findUniqueOrThrow(args: FindUniqueArgs<T>): Promise<T>
  findFirstOrThrow(args?: FindFirstArgs<T>): Promise<T>
}
```

Because `useLiveQuery<T>` infers `T` from the return type of `QueryFunction<T>`,
and `db.post` is typed as `ModelDelegate<GqlormScalar.Post>`, TypeScript infers
`T = GqlormScalar.Post[]` automatically — no explicit generic needed.

The existing explicit generic override (`useLiveQuery<MyType>(...)`) continues
to work and takes precedence.

> **Note:** The exact conditional type mechanics for bridging
> `GqlormTypeMap.models` through `FrameworkDbClient` and into the `ModelDelegate`
> specialisation may require iteration during implementation. The invariant to
> verify is: `useLiveQuery((db) => db.post.findMany())` infers `T` as a type
> containing only visible scalar fields. Detailed type signatures should be
> confirmed against the TypeScript compiler during this phase.

---

### Phase 4: Backend — Auto-Generated Resolvers

**Goal**: When `experimental.gqlorm.enabled = true` in `cedar.toml`, the Cedar GraphQL server
automatically generates type definitions and resolver functions for every
non-hidden Prisma model. The auth model is fixed and secure by default — no
per-model access configuration is required.

This is completely separate from Cedar's existing SDL + services pattern. The two
can coexist in the same app.

#### 4.1 Add `buildGqlormSchema()` in `packages/graphql-server`

Create `packages/graphql-server/src/gqlorm/buildGqlormSchema.ts`.

This function:

- Accepts the Prisma `db` client instance.
- Reads `Prisma.dmmf.datamodel.models` — available as a static property on the
  generated `Prisma` namespace, requiring no async I/O.
- Reads the `[experimental.gqlorm]` section of `cedar.toml` via `getConfig()` — for the
  organization and membership model convention.
- For each model:
  - Skips the model entirely if `model.documentation` contains `@gqlorm hide`.
  - Applies the same field visibility logic as codegen (step 1.1): skip fields
    with `@gqlorm hide`, include fields with `@gqlorm show`, auto-skip fields
    matching sensitivity heuristics (logging a startup notice for any auto-hidden
    field that has no directive, mirroring the codegen warning).
  - Generates a GraphQL type definition string using only visible fields.
  - Generates Query field definitions.
  - Generates a resolver function with the fixed auth model (see 4.3).
- Returns `{ schema: DocumentNode, resolvers: Record<string, unknown> }` — the
  exact shape required by `SdlGlobImports` in `packages/graphql-server`.

**Prisma DMMF type → GraphQL SDL type mapping:**

| DMMF `type` | SDL type   |
| ----------- | ---------- |
| `String`    | `String`   |
| `Int`       | `Int`      |
| `Float`     | `Float`    |
| `BigInt`    | `BigInt`   |
| `Boolean`   | `Boolean`  |
| `DateTime`  | `DateTime` |
| `Json`      | `JSON`     |
| `Decimal`   | `String`   |
| `Bytes`     | `String`   |
| Enum type   | `String`   |

Nullability is derived from `field.isRequired`. The `@id` field is always
non-null.

#### 4.2 Wire into `createGraphQLHandler`

In `packages/graphql-server/src/functions/graphql.ts`, check config and merge
the gqlorm schema before calling `createGraphQLYoga`:

```ts
if (getConfig().experimental?.gqlorm?.enabled) {
  const gqlormEntry = await buildGqlormSchema(db)
  if (gqlormEntry) {
    handlerOptions.sdls = {
      ...handlerOptions.sdls,
      __gqlorm__: gqlormEntry,
    }
  }
}
```

The `__gqlorm__` key is a reserved internal name that cannot clash with
user-authored SDL keys (which are derived from file names). This flows into the
existing `makeMergedSchema` pipeline unchanged.

#### 4.3 Auth model: fixed, secure by default

All auto-generated resolvers apply the same layered auth model. There are no
per-model access overrides — the behavior is uniform and predictable.

Because `buildGqlormSchema()` runs at startup with full knowledge of the DMMF
and the `[experimental.gqlorm]` config, resolver code is **statically
generated** with concrete field and model names. There are no runtime
`modelHasField` checks, no dynamic bracket lookups, and no config-driven
branching inside the resolver body. The generated code is as if a developer
wrote it by hand.

In the examples below, the names `userId`, `organizationId`, `membership`,
`organizationId` (on the membership model), `post`, etc. are **not hardcoded** —
they are derived at generation time from:

- the DMMF (which model exists, which fields it has)
- `cedar.toml` (what the membership model is called, what its columns are named)

The examples show a model named `Post` with fields `userId` and
`organizationId`, and a membership model named `Membership` with fields
`userId` and `organizationId`. A different schema would produce different
concrete names.

**`findMany` resolver** (for a model with `userId` and `organizationId`):

```ts
posts: async (_root, args, context) => {
  requireAuth()

  const where: Record<string, unknown> = { ...(args.where ?? {}) }

  // Post has a userId field — scope to current user
  where['userId'] = context.currentUser.id

  // Post has an organizationId field — scope to user's organizations
  const memberships = await db.membership.findMany({
    where: { userId: context.currentUser.id },
    select: { organizationId: true },
  })
  const organizationIds = memberships.map((m) => m.organizationId)
  where['organizationId'] = { in: organizationIds }

  return db.post.findMany({ where })
}
```

For a model without `userId`, the `where['userId']` line is simply not emitted.
For a model without `organizationId`, the membership lookup block is omitted
entirely. The generated resolver contains only the checks that apply to that
specific model.

**`findUnique` / `findFirst` resolver** (for a model with `userId` and
`organizationId`):

```ts
post: async (_root, { id }, context) => {
  requireAuth()

  const record = await db.post.findUnique({ where: { id } })
  if (!record) {
    return null
  }

  if (record.userId !== context.currentUser.id) {
    throw new ForbiddenError('Not authorized to access this resource')
  }

  const membership = await db.membership.findFirst({
    where: {
      userId: context.currentUser.id,
      organizationId: record.organizationId,
    },
  })
  if (!membership) {
    throw new ForbiddenError('Not authorized to access this resource')
  }

  return record
}
```

Again, each ownership check is only present if the model actually carries the
corresponding field.

#### 4.4 Field visibility: explicit directives and automatic hiding

The visibility of a field is determined identically in both `buildGqlormSchema()`
(backend) and `generateGqlormArtifacts()` (codegen/frontend). The same logic
applies in both places so the two tiers always agree on what is exposed.

**Visibility decision order for each scalar field:**

| Condition                                     | Outcome | Warning? |
| --------------------------------------------- | ------- | -------- |
| `field.documentation` contains `@gqlorm hide` | Hidden  | No       |
| `field.documentation` contains `@gqlorm show` | Visible | No       |
| Field name matches sensitivity heuristics     | Hidden  | **Yes**  |
| None of the above                             | Visible | No       |

The sensitivity heuristic list (case-insensitive, substring match on the field
name): `password`, `secret`, `token`, `hash`, `salt`, `key`.

**The auto-hide warning is the nudge, not the guard.** The field is hidden
regardless of whether the developer has seen the warning. The warning's purpose
is to prompt them to make the intent explicit, not to ask for permission before
hiding.

**Warning format** (printed at codegen time to stdout):

```
[gqlorm] User.hashedPassword was automatically hidden because its name
appears sensitive. Add a directive to suppress this warning:

  /// @gqlorm hide   — to confirm it should stay hidden
  /// @gqlorm show   — to explicitly expose it
```

The API server also logs this notice at startup for any field hidden by heuristic
without a directive, using the same message. Once either `/// @gqlorm hide` or
`/// @gqlorm show` is added to the field in `schema.prisma`, the warning stops
appearing in both places.

---

## Prisma Schema Annotations

gqlorm reads `/// @gqlorm` directives from Prisma's triple-slash doc comments.
These comments are preserved verbatim in the generated DMMF as `documentation`
strings on model and field objects.

> **Important**: Prisma uses `///` (three slashes) for doc comments that are
> preserved in the DMMF. Regular `//` (two slash) comments are stripped and
> never appear in DMMF. All `@gqlorm` directives must use `///`.

### On models

Place `/// @gqlorm hide` on the line immediately before the `model` keyword to
exclude the entire model from gqlorm — no GraphQL type, no resolvers, no
frontend types.

```prisma
/// @gqlorm hide
model InternalMigrationState {
  id    Int    @id @default(autoincrement())
  state String
}
```

Models with no directive are fully exposed (subject to field-level visibility
rules).

### On fields

Place the directive on the line immediately before the field declaration.

| Directive          | Behaviour                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/// @gqlorm hide` | Field excluded from GraphQL schema, resolvers, `ModelSchema`, and TypeScript interfaces. Suppresses the auto-hide warning for sensitive fields. |
| `/// @gqlorm show` | Field explicitly included. Use this on fields that match the sensitivity heuristic but should be exposed. Suppresses the auto-hide warning.     |

**Annotating sensitive fields:**

```prisma
model User {
  id       String @id @default(cuid())
  email    String @unique
  fullName String

  /// @gqlorm hide
  hashedPassword String

  /// @gqlorm hide
  salt String

  /// @gqlorm hide
  resetToken String?

  /// @gqlorm hide
  resetTokenExpiresAt DateTime?
}
```

**Explicitly exposing a field that would otherwise be auto-hidden:**

```prisma
model ApiKey {
  id   Int    @id @default(autoincrement())
  name String

  /// @gqlorm show
  keyPrefix String  // first 8 chars only — safe to display
}
```

### Directive parsing rules

- A model or field may carry at most one `@gqlorm` directive. If both `hide`
  and `show` appear on the same field, `hide` wins and a codegen warning is
  logged.
- Other content in the `documentation` string (regular doc comment text before
  or after the `@gqlorm` line) is ignored by gqlorm and left intact for other
  tooling.
- The directive parser is whitespace-tolerant: `/// @gqlorm hide` and
  `///  @gqlorm  hide` both parse correctly.
- `@gqlorm` is only recognised when it appears at the start of a line (after
  optional whitespace). This prevents false matches when `@gqlorm` appears
  incidentally in unrelated doc text (e.g., in a URL or example snippet).

---

## Configuration

All gqlorm runtime configuration lives in `cedar.toml`. Field and model
visibility are expressed as `/// @gqlorm` directives in `schema.prisma` (see
[Prisma Schema Annotations](#prisma-schema-annotations) above). There is no
separate `gqlorm.config.ts` or any other configuration file.

### Opt-in flag

```toml
[experimental.gqlorm]
enabled = true
```

Without this flag, none of the backend code paths are activated. The frontend
`ModelSchema` codegen and type generation run unconditionally whenever Prisma
models are detected, since they are purely additive.

### Membership-based organization access convention

Organization-scoped access requires knowing which Prisma models represent the
`Organization` entity and the `Membership` join table linking users to
organizations. The defaults assume a model named `Organization` and a model
named `Membership` with `userId` and `organizationId` fields. Override them if
your schema uses different names:

```toml
[experimental.gqlorm]
enabled = true

# Defaults — only specify if your schema differs from these names
organizationModel           = "Organization"  # the tenant/team entity
membershipModel             = "Membership"    # join table between users and orgs
membershipUserField         = "userId"        # field pointing to the user
membershipOrganizationField = "organizationId" # field pointing to the org
```

If `membershipModel` is not configured and no model with that default name
exists in the DMMF, the `organizationId` implicit filter is skipped and a
startup notice is logged so the behaviour is never silent.

---

## File Change Summary

### New Files

| Path                                                      | Description                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/internal/src/generate/gqlormSchema.ts`          | Reads Prisma DMMF including `/// @gqlorm` directives and sensitivity heuristics; emits `ModelSchema` JSON and scalar type declarations |
| `packages/gqlorm/src/setup.ts`                            | Exports `configureGqlorm()` — the public setup API that wraps `queryBuilder.configure()`                                               |
| `packages/graphql-server/src/gqlorm/buildGqlormSchema.ts` | Builds GraphQL type defs and resolvers from Prisma DMMF at API startup; applies same visibility rules as codegen                       |
| `packages/graphql-server/src/gqlorm/types.ts`             | Internal types for gqlorm resolver generation                                                                                          |

### Modified Files

| Path                                                | Change                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/internal/src/generate/generate.ts`        | Call `generateGqlormArtifacts()` as part of `generateTypeDefs()`                                                                                                   |
| `packages/internal/src/generate/watch.ts`           | Re-run `generateGqlormArtifacts()` when `api/db/schema.prisma` changes                                                                                             |
| `packages/vite/src/index.ts`                        | No changes needed — no Vite plugin injection for gqlorm setup                                                                                                      |
| `packages/graphql-server/src/functions/graphql.ts`  | Check `getConfig().experimental.gqlorm.enabled` and merge gqlorm schema into `sdls` when active                                                                    |
| `packages/graphql-server/src/types.ts`              | Add gqlorm-related options to `GraphQLHandlerOptions`                                                                                                              |
| `packages/gqlorm/src/queryBuilder.ts`               | Add `configure(options)` method to `QueryBuilder`                                                                                                                  |
| `packages/gqlorm/src/generator/graphqlGenerator.ts` | Add `setSchema(schema)` method to `GraphQLGenerator`                                                                                                               |
| `packages/gqlorm/src/types/orm.ts`                  | Add `ScalarTypeForModel` utility type; update `GqlormTypeMap` consumption for scalar model inference                                                               |
| `packages/gqlorm/src/react/useLiveQuery.ts`         | Verify and update type parameters to flow scalar model types through correctly                                                                                     |
| `packages/project-config/src/config.ts`             | Add `experimental.gqlorm` section to Cedar config schema (`enabled`, `organizationModel`, `membershipModel`, `membershipUserField`, `membershipOrganizationField`) |

### Generated Artifacts (user projects — `.cedar/` is gitignored)

| Path                                           | Description                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.cedar/gqlorm-schema.json`                    | Runtime `ModelSchema` (visible fields only); imported by user and passed to `configureGqlorm()`        |
| `.cedar/types/includes/web-gqlorm-models.d.ts` | Ambient scalar model type declarations augmenting `GqlormTypeMap` (hidden and sensitive fields absent) |

---

## Open Questions

1. **Package boundary for backend code.** `packages/graphql-server` currently
   has no dependency on `@prisma/client`. Adding gqlorm backend support would
   introduce that dependency (for DMMF access). An alternative is a new package
   `packages/gqlorm-api` that `packages/graphql-server` accepts as a plugin.
   Decision should weigh the cleanliness of a new package against the overhead
   of maintaining it.

2. **Mutations.** This plan covers read-only operations (`findMany`,
   `findUnique`). Auto-generated `create`, `update`, and `delete` mutations are
   a natural follow-up. The `/// @gqlorm hide` directive on a model would
   suppress them too, keeping the surface area consistent.

3. **`include` return types.** When a user writes
   `db.post.findMany({ include: { author: true } })`, the return type should
   include `author: GqlormScalar.User`. Phase 3 only handles the no-`select`
   / no-`include` case. This can be tackled as a follow-up once the scalar-only
   baseline is stable.

4. **Custom scalars.** Projects may define custom scalars (e.g., `JSON`,
   `Upload`). These should map to `unknown` in the generated TypeScript types
   with a comment. A follow-up can add a `cedar.toml` key for mapping custom
   scalar names to TypeScript types (e.g.,
   `gqlorm.scalarTypes.JSON = "Record<string, unknown>"`).

5. **Enum types.** DMMF enum fields (`field.kind === 'enum'`) are typed as
   `string` in this plan. A follow-up can generate proper union literal types
   from `dmmf.datamodel.enums`, giving users `'draft' | 'published'` instead
   of `string` for enum fields.

6. **Sensitivity heuristic exhaustiveness.** The auto-hide pattern list
   (`password`, `secret`, `token`, `hash`, `salt`, `key`, etc.) is inherently
   incomplete. The warning should be documented clearly so users understand it is
   advisory: it catches common cases but is not a security guarantee. Users
   should review their full model surface and use `/// @gqlorm hide` explicitly
   for anything sensitive, not rely solely on the heuristic.

7. **Plural naming for non-English model names.** `findMany` for model `Post`
   maps to query field `posts` (simple `+s`). This breaks for irregular plurals
   (e.g., `Person` → `people`, not `persons`). Cedar already has a pluralization
   dependency for SDL generation — gqlorm should use the same utility.

8. **Coexistence with user-authored SDLs for the same model.** If a user has
   both `experimental.gqlorm.enabled = true` and a hand-written `posts.sdl.ts`, there will be
   a type conflict in the merged schema. `buildGqlormSchema` should detect types
   already present in the user's SDL files and skip auto-generating those models,
   logging a warning.

9. **Directive parsing robustness.** The `documentation` string in DMMF may
   contain multi-line content when a model or field has both a regular doc comment
   and a `@gqlorm` directive. The parser must scan all lines rather than assuming
   the directive is the only content. The line-start anchor rule (only recognise
   `@gqlorm` when it appears at the beginning of a line after optional whitespace)
   protects against false matches in unrelated doc text.

10. **Multi-org membership defaults.** When `membershipModel` is not configured
    and no model with the default name exists in the DMMF, the `organizationId`
    implicit filter is skipped entirely. This behaviour is logged at startup
    when an `organizationId` field is detected on any model so the behaviour is
    never silent.

---

## Acceptance Criteria

**Frontend — field selection**

- [ ] `useLiveQuery((db) => db.post.findMany())` generates a GraphQL query
      selecting all visible scalar fields of `Post`, not just `id`
- [ ] Fields marked `/// @gqlorm hide` do not appear in the generated query
- [ ] Fields matching sensitivity heuristics with no directive do not appear in
      the generated query
- [ ] Fields marked `/// @gqlorm show` appear in the generated query even when
      their name matches the sensitivity heuristic list
- [ ] Relation fields (`author`, `posts`) are excluded from the default
      selection; explicit `include` or `select` is required to fetch them
- [ ] Explicit `select` still overrides automatic field selection and existing
      behaviour is unchanged
- [ ] The `ModelSchema` is regenerated automatically whenever `api/db/schema.prisma`
      changes during `yarn dev`

**Frontend — setup**

- [ ] `configureGqlorm({ schema })` is called once at app startup
- [ ] The schema is applied before the first `useLiveQuery` call runs
- [ ] Users can control where and how setup happens (App.tsx, bootstrap file, etc.)
- [ ] No Vite HTML injection or virtual-module resolution is required
- [ ] In test environments (Vitest/Jest), tests can import a stubbed setup helper,
      call `configureGqlorm({ schema: undefined })`, or skip setup entirely and
      rely on the `id`-only fallback without errors

**Frontend — type safety**

- [ ] In a TypeScript-aware editor, writing `useLiveQuery((db) => db.` shows
      model names (`post`, `user`, `contact`, …) as autocomplete suggestions
- [ ] The inferred return type of `useLiveQuery((db) => db.post.findMany())`
      contains only visible scalar fields (hidden and sensitive fields are absent)
- [ ] `DateTime` fields are typed as `string` in the generated scalar interfaces
- [ ] `useLiveQuery<ExplicitType>(...)` with an explicit generic still works and
      overrides inference

**Codegen warnings**

- [ ] A warning is printed during codegen for each field that is auto-hidden by
      heuristic and has no `/// @gqlorm` directive
- [ ] The warning message names the field, explains why it was hidden, and shows
      both `/// @gqlorm hide` and `/// @gqlorm show` as resolution options
- [ ] Adding `/// @gqlorm hide` to a field suppresses the warning for that field
- [ ] Adding `/// @gqlorm show` to a field suppresses the warning for that field
- [ ] No warning is printed for fields that do not match the sensitivity heuristic

**Backend — resolvers**

- [ ] With `experimental.gqlorm.enabled = true` in `cedar.toml`, the GraphQL server exposes
      auto-generated query fields for all non-hidden Prisma models
- [ ] All auto-generated resolvers call `requireAuth()`
- [ ] A model with a `userId` field: `findMany` automatically adds
      `where: { userId: currentUser.id }`, and `findUnique` asserts ownership
      after fetch
- [ ] A model with an `organizationId` field: `findMany` scopes records to the
      organizations the current user belongs to via `Membership`, and
      `findUnique` verifies the record's `organizationId` is accessible through
      membership
- [ ] `/// @gqlorm hide` on a model causes that model to be absent from the
      generated schema entirely
- [ ] `/// @gqlorm hide` fields are absent from the generated GraphQL type
      definition and are not selected in resolver Prisma calls
- [ ] Fields matching sensitivity heuristics with no directive are absent from
      the generated GraphQL type definition and resolver Prisma calls
- [ ] `/// @gqlorm show` fields appear in the generated type and resolver even
      when their name matches the sensitivity heuristic
- [ ] The API server logs a notice at startup for each field that is auto-hidden
      by heuristic without an explicit directive
- [ ] Adding a new model to `schema.prisma` automatically exposes it through the
      gqlorm backend (with `requireAuth` + implicit filters) without any change
      to `cedar.toml`
- [ ] Existing SDL-based types and resolvers are unaffected by enabling gqlorm
- [ ] If a model has both a user-authored SDL and a gqlorm auto-generated
      definition, the SDL definition wins and a warning is logged

**General**

- [ ] All existing `packages/gqlorm` tests pass without modification
- [ ] `yarn build` and `yarn dev` succeed in a fresh project after all changes
      are applied

---

## Testing & Verification Guide

### Unit and Type Tests

- Run `yarn test` to execute package-level unit/integration tests via Nx.
- Run `yarn test:types` to verify TypeScript type-level correctness, including
  the generated `GqlormScalar.*` interfaces and `useLiveQuery` inference.
- Tests are colocated with their packages (e.g. `packages/gqlorm/src/**/*.test.ts`).

### End-to-End Testing in a Real Cedar App

For larger changes, verify the full integration flow inside an actual Cedar
application:

1. Run `yarn build:pack` at the monorepo root to generate package tarballs.
2. Run `yarn install` inside `local-testing-project-live` to install the freshly
   packed packages.
3. **Ensure the test app has the required setup** (add these if not already
   present):
   - **`configureGqlorm()` call** — add to `App.tsx` or a bootstrap file:
     ```ts
     import { configureGqlorm } from '@cedarjs/gqlorm/setup'
     import schema from '.cedar/gqlorm-schema.json'
     configureGqlorm({ schema })
     ```
   - **`cedar.toml`** — enable gqlorm and configure membership convention:
     ```toml
     [experimental.gqlorm]
     enabled = true
     organizationModel   = "Organization"
     membershipModel     = "Membership"
     membershipUserField         = "userId"
     membershipOrganizationField = "organizationId"
     ```
   - **Prisma schema** — ensure models exist to exercise all auth paths:
     - A model with `userId` (e.g. `Post`) to test user-scoping
     - A model with `organizationId` (e.g. `Project`) to test membership-scoping
     - An `Organization` model and a `Membership` model with `userId` and
       `organizationId` fields
     - A model with sensitive fields (`hashedPassword`, `token`, etc.) to test
       the auto-hide heuristic and `/// @gqlorm hide` / `/// @gqlorm show`
       directives
4. Start the test app with `yarn dev` and verify:
   - `configureGqlorm({ schema })` runs without errors at startup
   - `useLiveQuery((db) => db.post.findMany())` returns all scalar fields, not
     just `id`
   - TypeScript autocomplete shows model names when typing `db.`
   - The inferred return type contains only visible scalar fields
   - `userId` scoping and `organizationId` membership-based access work
     correctly
   - `/// @gqlorm hide` / `/// @gqlorm show` directives are respected
5. Run `yarn build` in the test app to confirm production builds succeed.

### E2E Automation

- The Playwright smoke tests in
  `tasks/smoke-tests/live/tests/liveQuery.spec.ts` are the primary E2E
  validation for live-query behavior.
- Update this spec (if needed) to cover the new gqlorm functionality:
  - Verify that `useLiveQuery` returns all scalar fields (not just `id`) after
    `configureGqlorm({ schema })` is called
  - Verify that user-scoped and organization-scoped queries return only
    accessible records
  - Verify that hidden and sensitive fields are absent from the rendered output
- Run the tests against `local-testing-project-live`:
  ```
  CEDAR_TEST_PROJECT_PATH=local-testing-project-live yarn playwright test tasks/smoke-tests/live/tests/liveQuery.spec.ts
  ```
- Before running, ensure `local-testing-project-live` has the required setup:
  `configureGqlorm()` call in `App.tsx`, `[experimental.gqlorm]` in
  `cedar.toml`, and Prisma models with `userId` / `organizationId` fields.
