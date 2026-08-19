# gqlorm auth scoping implementation plan

## Summary

This plan translates the ideas in `GQLORM_AUTH_SCOPING_PROPOSAL.md` into the
current Cedar gqlorm architecture.

The key implementation reality is that gqlorm is **not** a runtime ORM layer on
the API side. Today it is split into two distinct parts:

1. **Frontend package (`packages/gqlorm`)**
   - captures Prisma-like read calls via a proxy
   - parses them into an internal AST
   - generates GraphQL query documents
   - powers `useLiveQuery`

2. **Backend codegen (`packages/internal/src/generate/gqlormSchema.ts`)**
   - reads Prisma DMMF at codegen time
   - generates `.cedar/gqlorm/backend.ts`
   - emits GraphQL SDL and concrete resolver functions
   - injects those generated resolvers into `api/src/functions/graphql.ts` via
     Babel

That means auth scoping for generated gqlorm reads should be designed primarily
as a **codegen-backed backend feature**, with a small runtime helper layer where
needed.

The proposal's core idea is still directionally correct: generated reads should
accept **model-level, operation-aware auth scopes that produce Prisma-style
`where` constraints**. But the implementation should fit Cedar's actual
architecture:

- auth scope configuration should be loaded by the **code generator**
- generated resolvers should call into a **small runtime auth helper** or
  generated app auth module
- scope merging must happen against the **GraphQL resolver args** that
  gqlorm-generated queries already send
- the initial rollout must account for the fact that the generated backend
  currently only exposes:
  - plural field for `findMany`
  - singular field for `findUnique` and the client-side abstractions layered on
    top of it
- `findFirst` currently exists only as a **frontend query-builder abstraction**
  mapped to the singular GraphQL field, not as a distinct backend resolver
  semantics layer

## Current product stance

At this stage, gqlorm auth should remain intentionally narrow and
convention-driven.

The generated backend is most valuable when it can stay almost entirely
codegen-based, with behavior inferred from schema shape and a very small amount
of existing configuration. We do **not** want to expand `cedar.toml` into a
broad auth configuration surface, and we do **not** want Prisma schema comments
to evolve into a mini auth DSL.

For now, the preferred boundary is:

- if a project fits gqlorm's built-in conventions, use generated gqlorm reads
- if it does not, use traditional Cedar SDL + service resolvers for that model

In other words, gqlorm should currently be treated as a convenience layer for
convention-aligned read access, not a universal generated authorization system.

We should revisit broader auth extensibility only after collecting several
concrete real-world use cases that clearly justify a more general abstraction.

## Current implementation snapshot

### Frontend gqlorm

Current frontend responsibilities live in `packages/gqlorm`:

- `QueryBuilder` captures proxy calls and produces GraphQL queries.
- `QueryParser` converts Prisma-like args into an AST.
- `GraphQLGenerator` turns that AST into a GraphQL query string.
- `useLiveQuery` executes the generated query through `@cedarjs/web` Apollo.
- `configureGqlorm()` installs schema metadata from `.cedar/gqlorm-schema.json`
  so default selections include all visible scalar fields.

Important details:

- Supported client operations are:
  - `findMany`
  - `findUnique`
  - `findFirst`
  - `findUniqueOrThrow`
  - `findFirstOrThrow`
- `findFirst`/`findFirstOrThrow` are currently frontend-level abstractions. The
  generator maps them to the same singular GraphQL field name as `findUnique`.
- The query builder already supports `where`, `orderBy`, `take`, `skip`,
  `select`, and nested relation-ish shapes in the AST.

### Backend gqlorm generation

Current backend generation lives in
`packages/internal/src/generate/gqlormSchema.ts`.

It already does all of the following:

- reads the Prisma DMMF
- applies visibility rules (`@gqlorm hide`, `@gqlorm show`, sensitive-field
  filtering)
- skips models that already have a user-authored SDL type
- generates `.cedar/gqlorm/backend.ts`
- emits:
  - GraphQL type definitions
  - plural query fields
  - singular query fields for id-based lookup
  - concrete resolver implementations

Generated backend injection is handled by:

- `packages/babel-config/src/plugins/babel-plugin-cedar-gqlorm-inject.ts`

That plugin imports the generated backend module and mutates the `sdls` object
before `createGraphQLHandler()` runs.

### Current auth behavior

The current auth model is hard-coded and convention-based.

The generator inspects field names and emits resolver logic based on:

- `membershipUserField` defaulting to `userId`
- `membershipOrganizationField` defaulting to `organizationId`
- `membershipModel` defaulting to `Membership`

Current behavior:

- models with `userId` become user-scoped
- models with `organizationId` become organization-scoped if the membership
  model exists
- membership rows themselves are exempt from org-scoping
- plural resolvers throw `AuthenticationError` when auth is required but
  `context.currentUser` is missing
- singular resolvers fetch by id first, then throw `ForbiddenError` when the
  fetched row fails ownership/membership checks
- GraphQL SDL marks generated fields with `@requireAuth` or `@skipAuth`

This means the current system is already **auth-aware**, but only via
code-generated naming conventions.

## Where the proposal aligns with the codebase

The proposal is strongest in these areas:

1. **Per-model scoping is the right abstraction**
   - The current implementation already reasons per model during codegen.
   - Replacing hard-coded convention branches with per-model scope providers
     fits that pipeline well.

2. **Prisma-style `where` constraints are the right lingua franca**
   - Generated resolvers already call Prisma delegates with `where` objects.
   - The frontend query builder already emits GraphQL `where` args derived from
     Prisma-like input.
   - Merging auth scope with user filters is a natural extension of the current
     architecture.

3. **Convention-based auth should become a helper, not the foundation**
   - The current `userId` / `organizationId` logic is useful but narrow.
   - It can be retained as a built-in helper implemented through the same
     scope-provider mechanism.

4. **Treating unauthorized singular reads as not found is a better default than
   today's `ForbiddenError`**
   - Current generated singular resolvers leak that a row exists but is
     unauthorized.
   - Returning `null` after applying scope in the query itself is a better
     security model.

## Where the proposal does not yet match the codebase

### 1. There is no backend runtime gqlorm auth API today

There is currently no `@cedarjs/gqlorm/auth` package, no app-level auth config
loader, and no server-side registration path for model scopes.

Because the backend is generated into `.cedar/gqlorm/backend.ts`, the cleanest
first implementation is **not** to add a large dynamic plugin system
immediately. Instead:

- codegen should detect and wire a conventional app auth module if present
- generated resolvers should invoke a small runtime helper API with
  model/operation/context/args
- the helper returns a scope result that resolvers merge with incoming args

### 2. Backend resolver semantics are narrower than the proposal assumes

The proposal discusses:

- `findMany`
- `findFirst`
- `findUnique`

But the current backend exposes only:

- plural list field
- singular id field

`findFirst` on the frontend currently maps to the singular field name, but the
generated backend does not currently implement "find first authorized matching
row" behavior. It is effectively centered on id-based singular lookup.

So the rollout should not promise complete `findFirst` semantics until the
GraphQL backend surface is expanded.

### 3. Generated GraphQL schema currently does not accept the full user args shape for singular reads

Today the generated singular field is effectively:

- `<model>(id: ID): Model`

and plural supports only a limited generated shape. To support safe auth
merging, the backend should eventually accept generated `where` input shapes
that mirror the frontend query builder capabilities more closely.

Without that, some of the proposal's merge semantics remain only partially
realizable.

### 4. Relation-aware scoping is only fully possible if the generated GraphQL inputs can express nested `where`

The proposal's best examples rely on nested Prisma `where` trees, such as:

- `post: { authorId: currentUser.id }`
- `memberships: { some: { userId: currentUser.id } }`

The frontend parser/generator can already represent nested object conditions,
but the generated backend GraphQL schema and resolver contract need to support
those inputs consistently.

## Recommended implementation strategy

Implement this in three stages:

1. **Stage 1: Introduce server-side scope providers while keeping the existing
   GraphQL surface**
2. **Stage 2: Expand generated GraphQL args and singular semantics so scope
   merging is complete**
3. **Stage 3: Layer built-in helpers and ergonomics on top**

This keeps the change aligned with the existing codegen architecture and avoids
a large all-at-once rewrite.

---

## Stage 1 — Replace hard-coded auth branches with generated scope evaluation

### Goal

Introduce a real auth-scope system for generated backend resolvers, but keep the
existing gqlorm backend shape as stable as possible.

### Deliverables

#### 1. Add a runtime auth helper package in `packages/gqlorm`

Add a small server-safe module, for example:

- `packages/gqlorm/src/auth.ts`
- optionally `packages/gqlorm/src/auth-helpers.ts`

This module should export the core types:

- `GqlormScopeContext`
- `GqlormScopeResult`
- `GqlormModelScope`
- `GqlormAuthConfig`
- `defineGqlormAuth()`

Recommended first-pass types:

```/dev/null/gqlorm-auth-types.ts#L1-28
export type GqlormReadOperation = 'findMany' | 'findUnique'

export interface GqlormScopeContext {
  model: string
  operation: GqlormReadOperation
  currentUser: unknown
  args: Record<string, unknown> | null
  context: Record<string, unknown>
}

export interface GqlormScopeResult {
  where?: Record<string, unknown>
  deny?: boolean
}

export interface GqlormModelScopeConfig {
  scope?: (context: GqlormScopeContext) =>
    | GqlormScopeResult
    | Promise<GqlormScopeResult>
}

export interface GqlormAuthConfig {
  models?: Record<string, GqlormModelScopeConfig>
}

export function defineGqlormAuth(config: GqlormAuthConfig): GqlormAuthConfig {
  return config
}
```

Notes:

- Keep the first operation set small and honest: `findMany` and `findUnique`.
- Do not pretend `findFirst` is fully supported server-side yet.
- Use `unknown` for `currentUser` and generic context values, then narrow at the
  app boundary.

#### 2. Define a conventional app config location

Add support for a user-authored config file loaded by codegen and the generated
backend.

Recommended conventional path:

- `api/src/lib/gqlormAuth.{ts,js}`

Reasoning:

- it fits Cedar app conventions
- it keeps auth config on the API side where `currentUser` semantics belong
- it avoids introducing a new root-level config mechanism immediately

Generated code should not fail if the file is absent.

#### 3. Add app auth-config discovery to codegen

Extend `packages/internal/src/generate/gqlormSchema.ts` so codegen can determine
whether the app has a gqlorm auth config file.

Codegen does **not** need to execute the app auth config. It only needs to know
whether the generated backend should import and use it.

Suggested approach:

- detect `api/src/lib/gqlormAuth.ts` or `.js`
- if present, generate an import in `.cedar/gqlorm/backend.ts`
- if absent, fall back to built-in convention helpers or no custom scoping

#### 4. Move current convention-based auth into reusable helper functions

Before introducing custom scopes into generated resolvers, refactor the existing
hard-coded branches conceptually into helper logic.

At minimum, represent today's behavior as internal helpers such as:

- `ownerField('userId')`
- `organizationMembershipScope({...})`

These can initially live in codegen internals or in
`packages/gqlorm/src/auth-helpers.ts`.

The important point is architectural: current behavior should become **one
strategy** producing `GqlormScopeResult`, not bespoke code emitted inline
everywhere.

#### 5. Add scope merge helpers to generated backend output

Generated resolvers need helper utilities to combine user filters with auth
scopes.

Generate or import helpers equivalent to:

```/dev/null/gqlorm-auth-merge.ts#L1-24
function andWhere(
  authWhere: Record<string, unknown> | undefined,
  userWhere: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (authWhere && userWhere) {
    return {
      AND: [authWhere, userWhere],
    }
  }

  if (authWhere) {
    return authWhere
  }

  if (userWhere) {
    return userWhere
  }

  return undefined
}
```

Also add a helper to evaluate the effective scope for a model and operation.

#### 6. Change generated plural resolvers to apply scoped `where`

Today generated plural resolvers build `where` from conventions only.

Refactor them so they:

1. inspect incoming args
2. evaluate custom model scope if configured
3. evaluate built-in convention scope if no custom model scope exists, or
   combine according to a clear precedence rule
4. merge auth scope with user `where`
5. call Prisma `findMany({ where: mergedWhere, select })`

Recommended precedence for v1:

- if the app defines a model scope, use it
- otherwise, use built-in convention scoping

That avoids surprise double-scoping and keeps the migration path predictable.

#### 7. Change generated singular resolvers to query _within_ scope rather than check after fetch

This is the most important security correction.

Today the generated singular resolver often does:

1. `findUnique({ where: { id } })`
2. inspect the record
3. throw `ForbiddenError` if unauthorized

Instead, for scoped models it should do one of the following:

- construct a merged `where` containing both the requested id and auth scope,
  then query within that scope
- or fall back to `findFirst({ where: { AND: [...] } })` if the merged shape is
  not compatible with `findUnique`

Recommended v1 behavior:

- use `findFirst` internally for scoped singular queries
- build `where` as `AND: [{ id: requestedId }, authWhere]`
- return `null` if no matching authorized record exists

This aligns with the proposal's safer default and avoids resource enumeration.

#### 8. Remove generated `ForbiddenError` usage for scoped singular reads

Once singular reads are performed inside the authorized scope:

- unauthorized rows naturally become indistinguishable from missing rows
- `ForbiddenError` is no longer needed for standard scoped reads

Keep explicit `AuthenticationError` or equivalent only when a scope provider
returns `deny: true` because the operation is categorically disallowed.

#### 9. Revisit generated GraphQL auth directives

Current generated fields use `@requireAuth` / `@skipAuth` based on convention
detection.

With model scope providers, that becomes inaccurate.

For Stage 1, choose one of these options:

- **Option A:** keep `@skipAuth` on gqlorm-generated fields and let
  resolver-level scope logic enforce access
- **Option B:** introduce a new internal marker strategy, but do not rely on
  schema directives for gqlorm auth decisions

I recommend Option A for v1. The directive layer is too coarse for
operation-aware scoping and mixed public/private behavior.

### Stage 1 file changes

#### `packages/gqlorm`

- add `src/auth.ts`
- add helper exports from package entrypoints
- add tests for `defineGqlormAuth`, merge helpers, and scope result semantics

#### `packages/internal/src/generate/gqlormSchema.ts`

- add auth config file detection
- refactor current auth emission logic
- generate backend helper functions/imports
- generate plural resolvers that merge user args + auth scope
- generate singular resolvers that query within scope and return `null` when out
  of scope

#### `packages/internal/src/__tests__/gqlormSchema.test.ts`

Add tests for:

- generated backend imports app auth config when present
- generated backend omits auth imports when absent
- plural resolver code merges `where` with auth scope
- singular resolver code uses scoped lookup instead of post-fetch
  `ForbiddenError`
- `deny: true` path emits the expected error behavior
- built-in convention helpers still generate equivalent behavior for existing
  schemas

#### Fixtures / local testing project

Add a minimal custom auth example, likely a model that does **not** use `userId`
or `organizationId`, to prove that custom per-model scopes work where
conventions do not.

---

## Stage 2 — Expand generated GraphQL input types and true operation semantics

### Goal

Make the backend capable of expressing the proposal's merge semantics
completely, especially for nested Prisma-style filters and operation-aware
behavior.

### Why this stage is needed

The proposal assumes auth scopes can be merged with any user-supplied `where`
tree. That is only fully true if the generated GraphQL schema accepts a
sufficiently expressive input shape.

Today gqlorm already has frontend AST support for rich filters, but the backend
GraphQL schema generation needs to expose matching input types and argument
shapes.

### Deliverables

#### 1. Generate GraphQL input types for visible models

For each gqlorm-managed model, generate input types for at least:

- `<Model>WhereInput`
- scalar filter inputs as needed
- logical operators `AND`, `OR`, `NOT`
- relation nested filters where practical
- optional `orderBy` inputs

This will let the generated backend accept richer args from frontend gqlorm
queries and from future direct GraphQL consumers.

#### 2. Update generated query fields to accept structured args

Plural fields should evolve toward something like:

```/dev/null/gqlorm-query-shape.graphql#L1-6
type Query {
  posts(where: PostWhereInput, orderBy: [PostOrderByInput!], first: Int, skip: Int): [Post!]!
  post(where: PostWhereInput): Post
}
```

This matters because the frontend generator already emits:

- `where`
- `orderBy`
- `first`
- `skip`

for singular and plural operations.

#### 3. Make backend semantics explicit for `findFirst`

Once singular fields accept a full `where` shape, add backend semantics that
distinguish:

- `findUnique`: id/unique-oriented lookup within scope
- `findFirst`: first matching row within scope

There are two viable approaches:

- generate separate GraphQL fields for unique vs first semantics
- or keep one singular GraphQL field and encode mode in args or client behavior

I recommend eventually generating distinct server semantics, even if the
frontend keeps a friendly Prisma-style abstraction.

#### 4. Support nested relation scoping properly

Relation-aware scopes from the proposal become credible only once generated
where inputs support nested relation filters.

Examples this stage should unlock:

- `Comment` scoped by `post.authorId`
- `Project` scoped by `memberships.some.userId`
- mixed OR/AND public/private scopes

#### 5. Add debug/tracing hooks for effective auth scope

Because generated resolvers can become opaque, add optional debug output in dev
mode.

For example, behind a debug flag:

- log the model and operation
- log whether built-in or custom scope was used
- log the final merged `where` object

Use pretty-printed `JSON.stringify(data, null, 2)` if this is sent to
`console.log`.

### Stage 2 file changes

- `packages/internal/src/generate/gqlormSchema.ts` — major schema/input
  generation work
- `packages/gqlorm/src/generator/graphqlGenerator.ts` — ensure client output
  matches generated backend input shape
- tests across both packages for nested filters and operation-specific behavior

---

## Stage 3 — Ergonomics, built-in helpers, and advanced hooks

### Goal

Make the new auth model pleasant to use without losing the flexibility
introduced in Stages 1 and 2.

### Deliverables

#### 1. Public helper APIs

Add helper creators such as:

- `ownerField('userId')`
- `ownerField('authorId')`
- `membershipScope({...})`
- `publicWhen(...)`

These helpers should return `GqlormModelScopeConfig` objects compatible with
`defineGqlormAuth()`.

#### 2. Unauthorized behavior configuration

Support per-model behavior such as:

- `unauthorizedResult: 'notFound'`
- `unauthorizedResult: 'forbidden'`

Default should remain `notFound` for read-side row-level scoping.

#### 3. Optional advanced hooks

Only after the model-scope API is stable, consider lower-level hooks such as:

- `beforeResolve`
- `transformArgs`

These should be explicitly advanced and should not replace model scopes as the
main abstraction.

#### 4. Better docs and migration guidance

Update gqlorm docs to explain:

- current built-in convention behavior
- custom scope providers
- recommended migration from convention-only auth
- limitations around generated GraphQL inputs if any remain

---

## Concrete design decisions recommended for implementation

### 1. Config location

Use a conventional app auth module first:

- `api/src/lib/gqlormAuth.ts`

Do not start with a `cedar.toml`-embedded DSL.

### 2. Scope precedence

For v1:

- custom model scope overrides built-in convention scope
- built-in convention scope is the fallback when custom scope is absent

This keeps behavior predictable and avoids accidental over-constraining.

### 3. Unauthorized singular reads

Default to:

- query within scope
- return `null` when not found or out of scope

This is better than the current `ForbiddenError` behavior.

### 4. `deny: true`

Use `deny: true` only for categorical denial of the operation, not for row-level
mismatch.

Row-level mismatch should become `null` for singular or empty list for plural.

### 5. Supported operations in v1

Be explicit that server-side scoped semantics initially cover:

- `findMany`
- `findUnique`-style singular reads

Do not oversell `findFirst` until the backend GraphQL layer supports it
properly.

### 6. Keep generated code readable

The current gqlorm backend generation philosophy is to emit concrete,
understandable code. Preserve that.

Even if some helper calls are added, the generated backend should still read
like understandable application code rather than a deeply abstract runtime
interpreter.

---

## Suggested implementation phases and order

### Phase A — Internal refactor without public API breakage

1. Extract current convention-based auth logic into scope-result-producing
   helpers.
2. Update generated singular resolvers to query within scope and return `null`
   instead of throwing `ForbiddenError`.
3. Add tests proving existing convention-based behavior still works.

This phase gives an immediate security improvement and reduces coupling.

### Phase B — Public auth config API

1. Add `defineGqlormAuth()` and types in `packages/gqlorm`.
2. Add app auth file discovery in codegen.
3. Generate backend imports and scope-evaluation calls.
4. Add fixture demonstrating non-conventional auth.

### Phase C — Full `where` merging and richer generated input shapes

1. Expand generated GraphQL input types.
2. Align frontend query generation and backend args.
3. Add nested relation-scoping tests.
4. Add operation-aware examples and docs.

### Phase D — Helpers and polish

1. Public helper builders.
2. Unauthorized behavior configuration.
3. Optional debug traces.
4. Final docs updates.

---

## Testing plan

### Unit tests

#### `packages/gqlorm`

Add tests for:

- `defineGqlormAuth()` identity behavior
- sync and async scope providers
- merge helper behavior for auth `where` + user `where`
- `deny: true` semantics

#### `packages/internal/src/__tests__/gqlormSchema.test.ts`

Add generation tests covering:

- custom auth module present vs absent
- generated resolver code for user-supplied scope
- convention helper fallback behavior
- singular resolver returns `null` path instead of `ForbiddenError`
- organization-membership scopes expressed through helper calls rather than
  bespoke inline code

### Integration tests

Add a fixture model that proves custom auth is needed, for example:

- `Game`
- `PlayerSession`
- `Cell`

with access based on `gameId` from `currentUser` or session state rather than
`userId` / `organizationId`.

Then verify:

- authorized list reads return only scoped rows
- unauthorized singular reads return not found behavior
- custom scopes override conventions when both could apply

### Smoke tests

Extend live-query smoke tests to ensure gqlorm still works end-to-end when auth
scoping is enabled.

---

## Risks and open questions

### 1. How should generated code import app auth config safely?

The Babel-injected backend already imports generated `.cedar/gqlorm/backend.ts`
from `graphql.ts`. If backend code also imports `src/lib/gqlormAuth`, confirm
that path resolution works in both dev and build the same way `src/lib/db` does.

### 2. Should scope providers run at runtime only, or be partially compiled during codegen?

For v1, runtime execution is fine. Codegen should only wire the import and
helper calls.

### 3. How far should relation-aware filtering go in the generated GraphQL schema?

This is the biggest scope-expander. Keep Stage 1 modest and only promise what
the current generated inputs can support.

### 4. Should gqlorm generated fields use GraphQL auth directives at all?

Given operation-aware and mixed public/private scopes, resolver-level
enforcement is more expressive than static directives. Static directives may
become misleading.

### 5. Should `findUniqueOrThrow` map unauthorized to throw or not-found?

Recommended behavior:

- resolver returns `null` for unauthorized/out-of-scope
- client-side `findUniqueOrThrow` then throws as it already does for missing
  data

That preserves the abstraction boundary and avoids leaking authorization
details.

---

## Bottom line

The proposal's main idea is good, but the implementation must be adapted to
Cedar's real gqlorm architecture.

The right foundation is:

- **server-side model scope providers**
- loaded through a conventional API-side config file
- wired into **generated backend resolvers**
- merged with incoming GraphQL args using Prisma-style `where` semantics
- with singular reads executed **inside** scope and defaulting to **not found**

The first milestone should **not** try to solve every future auth concern. It
should:

1. refactor the existing convention-based codegen auth into reusable scope logic
2. add a public `defineGqlormAuth()` API
3. let generated resolvers apply model-level scopes for `findMany` and singular
   id-based reads
4. return `null` for out-of-scope singular records

That gives Cedar a realistic path from today's convention-only auth to the more
flexible model described in the proposal, without fighting the current codebase
structure.
