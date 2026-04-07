# Task: Implement `configureGqlorm()` Setup API

## Context

This is the smallest self-contained piece of the
[gqlorm schema-aware fields plan](./gqlorm-schema-aware-fields-and-types-plan.md)
that can be fully implemented and tested end-to-end.

**The core problem it solves:**
Right now, `useLiveQuery((db) => db.post.findMany())` with no explicit `select`
generates a GraphQL query that only requests the `id` field. The `QueryBuilder`
and `GraphQLGenerator` already support schema-aware field selection — a
`ModelSchema` can be passed at construction time and the generator will use it.
But there is no public API to apply a schema after construction, and no
`configureGqlorm()` entry point that users can call at app startup.

This task adds exactly those missing pieces.

---

## Scope

**Files to create:**

- `packages/gqlorm/src/setup.ts` — public `configureGqlorm()` API
- `packages/gqlorm/src/__tests__/configureGqlorm.test.ts` — full test suite

**Files to modify:**

- `packages/gqlorm/src/generator/graphqlGenerator.ts` — add `setSchema()` method
- `packages/gqlorm/src/queryBuilder.ts` — add `configure()` method
- `packages/gqlorm/package.json` — add `./setup` export entry

**Files NOT in scope (follow-up tasks):**

- Codegen (`generateGqlormArtifacts()` in `packages/internal`) — Phase 1
- TypeScript scalar type declaration generation — Phase 1
- Backend auto-generated resolvers (`buildGqlormSchema()`) — Phase 4
- `@gqlorm hide` / `@gqlorm show` directive parsing — Phase 1
- Sensitivity heuristics — Phase 1

---

## Implementation

### 1. Add `setSchema()` to `GraphQLGenerator`

In `packages/gqlorm/src/generator/graphqlGenerator.ts`, add a public method
after the constructor:

```ts
setSchema(schema: ModelSchema | undefined): void {
  this.#schema = schema
}
```

The method is idempotent — calling it multiple times with different schemas is
safe and the last call wins. Calling it with `undefined` reverts to the
`id`-only fallback.

### 2. Add `configure()` to `QueryBuilder`

In `packages/gqlorm/src/queryBuilder.ts`, add a public method:

```ts
configure(options: Partial<QueryBuilderOptions>): void {
  this.#options = { ...this.#options, ...options }
  if (options.schema !== undefined) {
    this.#generator.setSchema(options.schema)
  }
}
```

Notes:

- Merges the incoming options over the existing options (non-destructive).
- Only forwards `schema` to the generator when explicitly provided (i.e., the
  key is present in the options object). This lets callers update other options
  without accidentally clearing the schema.
- The `#generator` field is currently `readonly` — that is fine because we are
  calling a method on it, not replacing it.

### 3. Create `packages/gqlorm/src/setup.ts`

```ts
import { queryBuilder } from './queryBuilder.js'
import type { ModelSchema } from './types/schema.js'

export interface ConfigureGqlormOptions {
  schema: ModelSchema | undefined
}

/**
 * Configure gqlorm at app startup.
 *
 * Call this once before any `useLiveQuery` invocations — typically at the top
 * of `App.tsx` or in a dedicated bootstrap file.
 *
 * @example
 * import { configureGqlorm } from '@cedarjs/gqlorm/setup'
 * import schema from '.cedar/gqlorm-schema.json'
 *
 * configureGqlorm({ schema })
 */
export function configureGqlorm(options: ConfigureGqlormOptions): void {
  queryBuilder.configure({ schema: options.schema })
}
```

### 4. Add `./setup` export to `package.json`

Add the following entry to the `"exports"` map in
`packages/gqlorm/package.json`:

```json
"./setup": {
  "import": {
    "types": "./dist/setup.d.ts",
    "default": "./dist/setup.js"
  },
  "require": {
    "types": "./dist/cjs/setup.d.ts",
    "default": "./dist/cjs/setup.js"
  }
}
```

---

## Tests

Create `packages/gqlorm/src/__tests__/configureGqlorm.test.ts`.

The test suite must cover all of the following scenarios:

### Test group: `GraphQLGenerator.setSchema()`

- **`setSchema()` switches from id-only fallback to schema fields**
  - Construct a `GraphQLGenerator` with no schema.
  - Generate a `findMany` query for `post` — assert the field selection is
    `id` only.
  - Call `setSchema({ post: ['id', 'title', 'body'] })`.
  - Generate the same query again — assert the field selection now includes
    `id`, `title`, and `body`.

- **`setSchema(undefined)` reverts to id-only fallback**
  - Construct a `GraphQLGenerator` with a schema.
  - Call `setSchema(undefined)`.
  - Generate a `findMany` query — assert only `id` is selected.

### Test group: `QueryBuilder.configure()`

- **`configure({ schema })` updates field selection for subsequent queries**
  - Construct a `QueryBuilder` with no options.
  - Build a `findMany` query — verify only `id` is present.
  - Call `configure({ schema: { user: ['id', 'email', 'fullName'] } })`.
  - Build the same query again — verify `id`, `email`, and `fullName` are
    all present.

- **`configure()` is non-destructive to other options**
  - Construct a `QueryBuilder` with `{ forceLiveQueries: true }`.
  - Call `configure({ schema: { user: ['id', 'email'] } })`.
  - Build a query and assert it still has `@live` in the query string.

- **`configure()` called multiple times — last schema wins**
  - Construct a `QueryBuilder`.
  - Call `configure({ schema: { post: ['id', 'title'] } })`.
  - Call `configure({ schema: { post: ['id', 'title', 'body', 'authorId'] } })`.
  - Build a `findMany post` query — assert all four fields are present.

- **Explicit `select` always overrides schema-based field selection**
  - Configure with `{ post: ['id', 'title', 'body'] }`.
  - Build a query with an explicit `select: { id: true, title: true }`.
  - Assert only `id` and `title` are present (body is absent).

### Test group: `configureGqlorm()`

- **`configureGqlorm({ schema })` produces schema-aware queries from the
  singleton `queryBuilder`**
  - Import `configureGqlorm` from `../setup.js`.
  - Import `buildQueryFromFunction` from `../queryBuilder.js`.
  - Call `configureGqlorm({ schema: { post: ['id', 'title', 'body', 'createdAt'] } })`.
  - Call `buildQueryFromFunction((db) => db.post.findMany())`.
  - Assert the generated query string contains `id`, `title`, `body`, and
    `createdAt`.

- **`configureGqlorm({ schema: undefined })` falls back to id-only selection**
  - Call `configureGqlorm({ schema: undefined })`.
  - Build a `findMany` query and assert only `id` is selected.

- **Calling `configureGqlorm()` twice is safe (idempotent)**
  - Call once with a small schema.
  - Call again with a larger schema.
  - Build a query and confirm the latest schema is in effect.

> **Important:** Because `configureGqlorm()` mutates the global `queryBuilder`
> singleton, the singleton tests must reset state between tests. Use a
> `beforeEach` / `afterEach` hook that calls
> `configureGqlorm({ schema: undefined })` (or
> `queryBuilder.configure({ schema: undefined })`) to restore the fallback
> state before each test.

---

## Acceptance Criteria

- [x] `GraphQLGenerator.setSchema()` exists and passes its tests.
- [x] `QueryBuilder.configure()` exists and passes its tests.
- [x] `packages/gqlorm/src/setup.ts` exists and exports `configureGqlorm()`.
- [x] `packages/gqlorm/package.json` exports `./setup`.
- [x] All tests in `configureGqlorm.test.ts` pass (`yarn test` in
      `packages/gqlorm`).
- [x] All pre-existing tests in `packages/gqlorm` continue to pass without
      modification.
- [x] TypeScript compiles with no errors (`yarn build:types` in
      `packages/gqlorm`).

---

## Verification Steps

```sh
# From the repo root:
cd packages/gqlorm

# Run all gqlorm tests (new + existing)
yarn test

# Type-check
yarn build:types
```

Expected output: all tests green, no TypeScript errors.

---

## What This Enables

Once this task is complete:

1. A user can call `configureGqlorm({ schema })` once at app startup (e.g. in
   `App.tsx`) with a hand-authored or eventually codegen-produced `ModelSchema`.
2. All subsequent `useLiveQuery((db) => db.post.findMany())` calls will generate
   GraphQL queries that select all fields listed in the schema for that model,
   instead of only `id`.
3. The codegen task (Phase 1: `generateGqlormArtifacts()`) can be implemented
   independently — its only job is to produce the `ModelSchema` JSON that users
   pass into `configureGqlorm()`. The runtime plumbing is already in place after
   this task.
