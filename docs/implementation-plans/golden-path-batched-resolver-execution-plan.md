# Batched Resolver Execution — Implementation Plan

## Table of Contents

- [Background & Motivation](#background--motivation)
- [Design Principles](#design-principles)
- [Current State](#current-state)
- [Architecture Overview](#architecture-overview)
- [Layer-by-Layer Design](#layer-by-layer-design)
  - [Layer 1: Resolver Wiring (`makeMergedSchema.ts`)](#layer-1-resolver-wiring-makemergedschemats)
  - [Layer 2: Service Function Signatures](#layer-2-service-function-signatures)
  - [Layer 3: Type System Updates](#layer-3-type-system-updates)
  - [Layer 4: Detection & Opt-Out](#layer-4-detection--opt-out)
  - [Layer 5: Error Handling](#layer-5-error-handling)
  - [Layer 6: Developer Experience & Codegen](#layer-6-developer-experience--codegen)
  - [Layer 7: OpenTelemetry](#layer-7-opentelemetry)
- [Implementation Phases](#implementation-phases)
- [Open Questions](#open-questions)

---

## Background & Motivation

The N+1 query problem is one of the most common performance pitfalls in GraphQL
APIs. Consider a query that fetches a list of posts, each with their author:

```graphql
query {
  posts {
    title
    author {
      name
    }
  }
}
```

With Cedar's current traditional resolver model, if 20 posts are returned, the
`author` resolver fires 20 separate times — once per post — producing 20
individual database round-trips. This is the N+1 problem.

The established community solution is
[DataLoader](https://github.com/graphql/dataloader), but it requires the
developer to:

1. Install and import DataLoader themselves.
2. Create a DataLoader instance per field per request.
3. Attach it to the GraphQL context.
4. Remember to use it in every relevant service function.

**Batch resolvers** are an alternative that solves the same problem by changing
the resolver contract itself: instead of a resolver being called once per parent
object, it is called once per _set_ of parent objects that appear in the same
request position. The framework handles the buffering and scheduling; the
developer just writes a bulk query.

This plan describes what it would take for Cedar to adopt batched execution as
the default for non-root field resolvers, eliminating the N+1 problem without
requiring any DataLoader configuration from the developer.

### Reference

This design is informed by the Batched Execution practice in the GraphQL
specification community, which defines the resolver contract as:

> A batch resolver receives a _list_ of all parent objects in that operation
> position. It must return a list of the same size where each entry is the value
> to use for the correlated parent object.

---

## Design Principles

1. **Batching by default for non-root fields.** Root operation type fields
   (`Query`, `Mutation`, `Subscription`) will always receive a single invocation
   — they have no parent objects to batch across. All other field resolvers will
   be batched automatically by the framework.

2. **No user-land configuration.** Developers should not need to install
   DataLoader, touch the GraphQL context, or do any per-field setup. The
   framework wires the batching at schema-build time.

3. **Explicit, well-named opt-out.** Escape hatches must exist, but they should
   be deliberately named to signal that opting out surrenders the N+1 protection
   (e.g. `singleResolver()`).

4. **Per-request isolation.** Batch caches must be keyed to the GraphQL context
   object (which is per-request) to prevent cross-request data leaks. No
   cross-request batching.

5. **Length invariant enforced by the framework.** If a batch resolver returns a
   list of a different length than its input, Cedar raises a clear error rather
   than silently producing mismatched or corrupt data.

6. **Per-item errors, not whole-batch failures.** A single failing item in a
   batch should produce a GraphQL field error for that item only. The rest of
   the batch result should still be returned.

---

## Current State

Cedar's GraphQL layer (`packages/graphql-server`) is built on GraphQL Yoga +
`@graphql-tools`. The critical path for resolver wiring is:

- **`makeMergedSchema.ts`** — `mapFieldsToService` iterates over all GraphQL
  type fields and, for each field without an explicit resolver, generates a
  wrapper that calls `services[name](args, { root, context, info })`.
- **`createGraphQLYoga.ts`** — assembles the schema and plugin chain.
- **`types.ts`** — defines `Resolver`, `ResolverArgs`, `Services`, etc.

The generated resolver wrapper today calls the service function **once per
parent object**, which is the source of the N+1 problem:

```ts
// packages/graphql-server/src/makeMergedSchema.ts (current)
[name]: async (root, args, context, info) => {
  return services[name](args, { root, context, info })
}
```

There is no DataLoader integration, no batching layer, and no framework
convention guiding developers toward bulk queries.

---

## Architecture Overview

The change is localized to Cedar's framework layer. User service functions get a
new signature for non-root fields; everything else (SDL, directives, auth,
logging, OpenTelemetry) continues to work unchanged.

```
GraphQL Request
      │
      ▼
 Cedar resolver wrapper  ←── wired by mapFieldsToService
      │
      │  (buffers root objects across a microtask tick)
      │
      ▼
 Batch flush (Promise.resolve().then)
      │
      ├──► services[Type][field](args, { roots: [...], context })
      │                                    ▲
      │                 array of parent objects (info intentionally omitted —
      │                 see Layer 1 and Layer 3 for rationale)
      │
      ▼
 Result array  ←── length-checked against roots array
      │
      ├──► per-slot resolve / reject
      │
      ▼
 GraphQL response
```

---

## Layer-by-Layer Design

### Layer 1: Resolver Wiring (`makeMergedSchema.ts`)

This is the core of the change. The `mapFieldsToService` function currently
generates a single-call wrapper. It would instead generate a wrapper that:

1. On first call for a given `(context, typeName, fieldName)` tuple, creates a
   pending batch entry and schedules a microtask flush via
   `Promise.resolve().then()`.
2. On subsequent calls within the same microtask, appends the `root` object to
   the batch.
3. On flush, calls the service function once with all accumulated roots, checks
   the length invariant, and resolves/rejects each individual promise.

#### Batch key design

The batch key must include a stable serialization of the field arguments, not
just the type and field names. Without args in the key, aliased fields with
different arguments on the same type — e.g.:

```graphql
{
  posts {
    fewTags: limitedTags(limit: 3)
    manyTags: limitedTags(limit: 10)
  }
}
```

— would collapse into a single batch. The second alias's `batchFn` (which closes
over `{ limit: 10 }`) would be silently dropped, and all parents would receive
results computed with `{ limit: 3 }` only. The key must therefore be
`${typeName}.${fieldName}:${stableSerialize(args)}`.

A simple stable serialization can use `JSON.stringify` with sorted keys. For the
common case of no arguments the suffix is just `:{}`, adding negligible
overhead.

#### `typeName` threading

`mapFieldsToService` currently only receives `fields`, `resolvers`, and
`services` — it does not have access to the name of the type being processed.
Both the batch key and the OTel span require `typeName`. The signature of
`mapFieldsToService` must be extended to accept `typeName: string`.
`mergeResolversWithServices` — which iterates `typesWithFields` and already
holds `type.name` — is the call site that passes it through.

#### `info` object semantics

Each of the N individual resolver invocations that feed a batch carries a
distinct `GraphQLResolveInfo` object (with a different `info.path.key` for each
parent position). The framework only has a single opportunity to call the batch
service function, so it cannot pass all N `info` objects in the existing scalar
slot.

**Decision:** batch resolvers do **not** receive `info` in the second argument.
The `BatchResolverArgs` type omits it entirely. Developers who genuinely need
field-level introspection should use `singleResolver()`. This matches the
behaviour of DataLoader, which also provides no `info` access, and keeps the
batch signature unambiguous. See [Open Questions](#open-questions) for
alternatives that were considered.

```ts
// Conceptual sketch — not final API

// Stable key serialization helper.
// We cannot use JSON.stringify's replacer-array form
// (e.g. `JSON.stringify(args, Object.keys(args).sort())`) because the
// replacer array is applied recursively as an allowlist: any property on a
// nested input-type object whose name does not appear among the top-level arg
// keys is silently omitted. Two aliased fields with different complex filter
// arguments would produce the same key and be incorrectly merged into one batch.
//
// Instead, we deep-sort keys at every level of nesting before serializing.
function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

function stableSerializeArgs(args: Record<string, unknown>): string {
  return JSON.stringify(deepSortKeys(args))
}

const pendingBatches = new WeakMap<
  object, // GraphQL context object as the per-request key
  Map<
    string, // `${typeName}.${fieldName}:${stableSerializeArgs(args)}`
    {
      roots: unknown[]
      resolvers: Array<(value: unknown) => void>
      rejecters: Array<(reason: unknown) => void>
      batchFn: (roots: unknown[]) => Promise<unknown[]>
    }
  >
>()

function enqueueBatch(
  context: object,
  key: string,
  root: unknown,
  batchFn: (roots: unknown[]) => Promise<unknown[]>
): Promise<unknown> {
  if (!pendingBatches.has(context)) {
    pendingBatches.set(context, new Map())
  }
  const contextBatches = pendingBatches.get(context)!

  if (!contextBatches.has(key)) {
    contextBatches.set(key, {
      roots: [],
      resolvers: [],
      rejecters: [],
      batchFn,
    })

    Promise.resolve().then(async () => {
      const batch = contextBatches.get(key)
      if (!batch) {
        return
      }
      contextBatches.delete(key)

      try {
        const results = await batch.batchFn(batch.roots)

        if (results.length !== batch.roots.length) {
          const err = new Error(
            `Batch resolver "${key}" returned ${results.length} item(s) for ` +
              `${batch.roots.length} input(s). The returned array must be the ` +
              `same length as the input array.`
          )
          batch.rejecters.forEach((r) => r(err))
          return
        }

        results.forEach((result, i) => {
          if (result instanceof Error) {
            batch.rejecters[i](result)
          } else {
            batch.resolvers[i](result)
          }
        })
      } catch (err) {
        batch.rejecters.forEach((r) => r(err))
      }
    })
  }

  return new Promise((resolve, reject) => {
    const batch = contextBatches.get(key)!
    batch.roots.push(root)
    batch.resolvers.push(resolve)
    batch.rejecters.push(reject)
  })
}
```

The generated resolver wrapper for a non-root field becomes:

```ts
// typeName is now threaded into mapFieldsToService from mergeResolversWithServices
[name]: (root, args, context, _info) => {
  const key = `${typeName}.${name}:${stableSerializeArgs(args)}`
  return enqueueBatch(
    context,
    key,
    root,
    (roots) => services[name](args, { roots, context }),
  )
}
```

The existing branch in `mergeResolversWithServices` that already separates root
types from other object types is exactly where this switch happens, and is also
where `typeName` is threaded into `mapFieldsToService`:

```ts
// packages/graphql-server/src/makeMergedSchema.ts
// This branch already exists — non-root types get servicesForType.
// type.name (e.g. "Post") must now be passed into mapFieldsToService
// as a new `typeName` parameter so batch keys and OTel spans can use it.
if (!['Query', 'Mutation', 'Subscription'].includes(type.name)) {
  servicesForType = mergedServices?.[type.name]
  // batch wiring applied here for non-root types
  // mapFieldsToService is called with { ..., typeName: type.name }
}
```

Root types (`Query`, `Mutation`, `Subscription`) keep their current
single-invocation behaviour unchanged.

---

### Layer 2: Service Function Signatures

This is the primary developer-facing change. For non-root type resolvers, the
second argument changes from `{ root }` to `{ roots }`:

```ts
// Root field resolvers — UNCHANGED
// (only ever called with a single value, no parent to batch)
export const posts = (args: QueryPostsArgs) => {
  return db.post.findMany()
}

export const post = ({ id }: QueryPostArgs) => {
  return db.post.findUnique({ where: { id } })
}

// Non-root field resolvers — NEW batch signature
export const Post = {
  // `roots` is the array of all Post parent objects in this request position
  author: (
    _args: never,
    { roots }: { roots: Post[] }
  ): Promise<(User | null)[]> => {
    const authorIds = roots.map((p) => p.authorId)
    return db.user
      .findMany({ where: { id: { in: authorIds } } })
      .then((users) =>
        roots.map((p) => users.find((u) => u.id === p.authorId) ?? null)
      )
  },

  tags: (_args: never, { roots }: { roots: Post[] }): Promise<Tag[][]> => {
    // Example: batched many-to-many via a join table
    return db.postTag
      .findMany({
        where: { postId: { in: roots.map((p) => p.id) } },
        include: { tag: true },
      })
      .then((postTags) =>
        roots.map((p) =>
          postTags.filter((pt) => pt.postId === p.id).map((pt) => pt.tag)
        )
      )
  },
}
```

The key invariant: **the returned array must be the same length as `roots`**,
with `null` or an `Error` instance per slot for missing or failed items. The
framework enforces this at runtime and throws a descriptive error if violated.

---

### Layer 3: Type System Updates

New types would be added to `packages/graphql-server/src/types.ts`:

```ts
// Existing — unchanged, used for root field resolvers
export type ResolverArgs<TRoot> = { root: ThenArg<TRoot> }

// New — used for non-root batched field resolvers.
// Note: `info` is intentionally omitted. Each root in the batch has a distinct
// GraphQLResolveInfo (different path.key), so there is no single authoritative
// info object to provide. Resolvers that need info should use singleResolver().
export type BatchResolverArgs<TRoot> = {
  roots: ThenArg<TRoot>[]
  context: CedarGraphQLContext
}

export type BatchResolver<TRoot = unknown, TReturn = unknown> = (
  args: Record<string, unknown>,
  batchArgs: BatchResolverArgs<TRoot>
) => Promise<(TReturn | null | Error)[]>

// A marker type for functions that explicitly opt out of batching
export type SingleResolver<TRoot = unknown, TReturn = unknown> = (
  args: Record<string, unknown>,
  resolverArgs: ResolverArgs<TRoot> & {
    context: CedarGraphQLContext
    info: GraphQLResolveInfo
  }
) => TReturn | Promise<TReturn>

// Tagged wrapper produced by singleResolver() helper
export type SingleResolverWrapper<TRoot = unknown, TReturn = unknown> = {
  __cedarSingleResolver: true
  fn: SingleResolver<TRoot, TReturn>
}
```

---

### Layer 4: Detection & Opt-Out

Cedar needs to detect at wiring time whether a service export is a batch
resolver or an explicitly opted-out single resolver.

**Detection approach:** Any non-root type field resolver is treated as a batch
resolver by default. An explicit `singleResolver()` wrapper opts out:

```ts
// packages/graphql-server/src/index.ts (new export)
export function singleResolver<TRoot, TReturn>(
  fn: SingleResolver<TRoot, TReturn>
): SingleResolverWrapper<TRoot, TReturn> {
  return { __cedarSingleResolver: true, fn }
}

// Usage in a service file:
import { singleResolver } from '@cedarjs/graphql-server'

export const Post = {
  // This field has a side-effect-heavy lookup that cannot be trivially batched
  computedRiskScore: singleResolver((_args, { root: post }) => {
    return externalRiskApi.score(post.id)
  }),
}
```

At wiring time in `mapFieldsToService`, Cedar checks for the
`__cedarSingleResolver` marker and applies the old single-call wrapper instead
of the batch wrapper:

```ts
const isSingleResolver = (fn: unknown): fn is SingleResolverWrapper =>
  typeof fn === 'object' &&
  fn !== null &&
  (fn as SingleResolverWrapper).__cedarSingleResolver === true

// In mapFieldsToService:
const serviceFn = services?.[name]
if (isSingleResolver(serviceFn)) {
  // old behaviour: call once per root
  return { ...resolvers, [name]: wrapSingleResolver(serviceFn.fn) }
} else {
  // new behaviour: batch across a microtask
  return { ...resolvers, [name]: wrapBatchResolver(serviceFn) }
}
```

---

### Layer 5: Error Handling

The spec requires per-item null/error results rather than failing whole batches.
Cedar's `useRedwoodError` plugin handles error masking and logging. It would
need to recognise `Error` instances returned as array slots (not thrown) and
convert them to GraphQL field errors:

- If `result[i]` is an `Error` instance, `rejecters[i](result[i])` is called,
  which causes the individual field to resolve as `null` with an associated
  GraphQL error — the standard GraphQL error propagation path.
- The remaining slots are unaffected.
- The `useRedwoodError` plugin's masking and logging applies to these per-slot
  errors the same way it applies to thrown errors today.

No changes to `useRedwoodError.ts` may be required if per-slot rejection
integrates correctly with GraphQL Yoga's existing error handling. This should be
validated during implementation.

---

### Layer 6: Developer Experience & Codegen

Two separate codegen sites produce service stubs and must both be updated:

- **`packages/cli/src/commands/generate/service/templates/service.ts.template`**
  — the template used by `cedar generate service` to scaffold new service files.
  This is the primary place developers first encounter the service function
  signature, so the batched stub shape must land here.
- **`packages/cli/src/commands/generate/sdl/templates/sdl.ts.template`** — the
  SDL generator, which also emits companion service stubs when
  `cedar generate sdl` is run with `--crud`.

Note: gqlorm is split across two packages — the runtime lives in
`packages/gqlorm` and the codegen (schema and service stub generation) lives in
`packages/internal`. Neither needs updating for batch resolvers. The codegen in
`packages/internal` unconditionally excludes relation fields, emitting only
scalar and enum fields as flat Query/Mutation root resolvers. There are no
type-level field resolvers in gqlorm output and therefore no N+1 exposure.

Both must emit batched stubs for non-root type field resolvers. Example output
for the CLI service template:

```ts
// Generated stub for Post type resolvers
export const Post = {
  /**
   * Batch resolver for Post.author
   *
   * Receives an array of Post parent objects and must return an array of the
   * same length, where each entry is the resolved value for the corresponding
   * parent (or null / an Error for missing / failed items).
   */
  author: (
    _args: Record<string, never>,
    { roots }: { roots: Post[] }
  ): Promise<(User | null)[]> => {
    throw new Error(
      'Post.author batch resolver not implemented. ' +
        'Load all authors for the given posts and return one per entry in roots.'
    )
  },
}
```

Single-call root field stubs (Query/Mutation) remain unchanged in both codegen
sites.

All generated stubs should include a comment pointing developers toward the
length invariant and the `singleResolver()` opt-out.

---

### Layer 7: OpenTelemetry

The existing `wrapWithOpenTelemetry` function in `makeMergedSchema.ts` wraps
individual resolver calls. With batching, a single batch flush replaces N
individual resolver invocations.

The current code uses tracer name `'redwoodjs'` and span name prefix
`redwoodjs:graphql:resolver:`. Introducing a separate `cedarjs:*` prefix for
batch resolvers would mean a single schema emits spans under two different
prefixes, breaking any dashboards or alert rules that match on that prefix.
Batch resolver spans must therefore use the **same prefix as the existing
non-batched spans**, updating both to `cedarjs:graphql:` as part of this work
(or keeping `redwoodjs:graphql:` if the rename is deferred — but they must
remain consistent with each other).

Changes needed:

- Align all span name prefixes to a single value (recommended:
  `cedarjs:graphql:`).
- Non-batched root resolver spans: `cedarjs:graphql:resolver:${name}`.
- Batch resolver spans:
  `cedarjs:graphql:batchResolver:${typeName}.${fieldName}`.
- A span attribute `graphql.batch.size` records how many root objects were in
  the batch (useful for diagnosing unexpectedly large or small batches).
- The span wraps the single batch function call rather than each individual
  invocation.
- Note: updating the tracer name from `'redwoodjs'` to `'cedarjs'` is a separate
  concern and should be tracked as its own task to avoid conflating the two
  changes.

---

## Implementation Phases

### Phase 1 — Foundation (no breaking changes)

- Add `BatchResolver`, `BatchResolverArgs`, `SingleResolverWrapper` types to
  `types.ts`.
- Implement `enqueueBatch` helper in a new internal module
  `packages/graphql-server/src/batchResolver.ts`.
- Export `singleResolver()` from `packages/graphql-server/src/index.ts`.
- Add unit tests for `enqueueBatch`: correct batching, length invariant error,
  per-slot error handling, per-request isolation.

### Phase 2 — Wiring (opt-in flag)

- Update `mapFieldsToService` to support batch wiring, gated behind a new
  `GraphQLYogaOptions` flag: `batchResolvers?: boolean` (default `false` during
  transition).
- Add integration tests: a schema with a non-root type resolver, asserting that
  the service function is called once with all roots rather than once per root.
- Update `wrapWithOpenTelemetry` to handle batch spans.

### Phase 3 — Default on

- Flip `batchResolvers` to default `true`.
- Update the service file template in
  `packages/cli/src/commands/generate/service/templates/service.ts.template` to
  emit batched stubs for non-root type resolvers.
- Update the SDL generator template in
  `packages/cli/src/commands/generate/sdl/templates/sdl.ts.template` to emit
  batched stubs for the companion service it generates alongside the SDL.
- Update documentation and the Cedar tutorial to use the batched signature.
- Add migration guide for existing projects (rename `root` to first element of
  `roots`, or wrap with `singleResolver()`).

### Phase 4 — Hardening

- Validate that `useRedwoodError` correctly masks and logs per-slot errors.
- Add max batch size configuration option per field (for services that degrade
  at large batch sizes).
- Consider a dev-mode warning when a batch resolver returns a same-length array
  that suspiciously looks like it made N individual queries (heuristic: duration
  scales linearly with batch size).
- Remove the `batchResolvers` feature flag once adoption is confirmed stable.

---

## Open Questions

1. **Backwards compatibility window.** How long should the
   `batchResolvers: false` default be kept before flipping? Should it be a major
   version bump?

2. **Max batch size per field.** The spec recommends offering a max batch size
   option. What should the default be — unlimited, or a safe cap like 1000?

3. **`args` in batch resolvers.** Within a single batch all roots share the same
   `args` (they are the same field invocation, just with different parents). The
   batch key serializes `args` to correctly segregate aliased fields with
   different arguments. What happens with `@stream` or incremental delivery —
   where parents may arrive across multiple ticks — still needs investigation.

4. **`info` alternatives considered.** The plan omits `info` from
   `BatchResolverArgs` entirely. Two alternatives were considered and rejected:
   (a) passing an array `infos: GraphQLResolveInfo[]` — added complexity for an
   edge case almost no batch resolver needs; (b) passing the first invocation's
   `info` — silently wrong for any code that inspects `info.path.key`. Omitting
   it with a clear error if accessed is the least surprising option. Revisit if
   a concrete use-case emerges.

5. **Subscription resolvers.** Subscriptions have a different execution model.
   Should batch resolvers apply to type-level fields resolved within a
   subscription payload? Likely yes, but needs explicit testing.

6. **`useRedwoodError` integration.** Does per-slot rejection via a rejected
   Promise already integrate cleanly with Yoga's error handling pipeline, or
   does `useRedwoodError` need to be taught about per-slot errors explicitly?

7. **DataLoader interop.** Some existing Cedar projects may already use
   DataLoader manually. The `singleResolver()` wrapper is the intended bridge,
   but should Cedar provide an explicit `dataLoaderResolver()` helper that
   adapts a DataLoader to the batch resolver contract?

8. **Directive compatibility.** Cedar's `useRedwoodDirective` wraps the
   `resolve` function on individual fields (via `mapSchema`). Does the batch
   resolver wrapping compose correctly with directive wrapping, or does the
   order of `mapSchema` vs `addResolversToSchema` need to be adjusted?
