# Fragment Cells: Future Work — `@defer`, Partial Errors, and Nullability

Follow-up ideas for the fragment Cells / query aggregation feature introduced in
#2107. Fragment Cells currently only support `Success`, `Empty`, `isEmpty` and
`afterQuery`. `Loading` and `Failure` were deliberately left out — this document
records why, and how they would earn their place later.

## Why fragment Cells have no `Loading` today

A fragment Cell doesn't own a network request — its parent does. The child's
loading state is absorbed into the parent's `Loading` by construction: the
parent's single aggregated request is the only async operation, and by the time
the parent's `Success` renders the fragment Cell, the child's slice of data is
already in hand. The read is synchronous, so there is no window in which a
mounted fragment Cell is waiting. A `Loading` export would be dead code. (This
matches Relay, where `useFragment` is synchronous and loading lives at query
boundaries.)

## The `@defer` story: where fragment Cell `Loading` becomes real

If the parent spreads a fragment with `@defer`:

```graphql
query FindBlogPostQuery($id: Int!) {
  post(id: $id) {
    id
    title
    author {
      ...AuthorCell_author @defer
    }
  }
}
```

then the initial payload arrives _without_ the child's slice, and a patch
streams in later. Now "parent is done, child is pending" is a real state — and
the fragment Cell's `Loading` is exactly the right place to express it:

- Parent `Success` renders immediately with the initial payload.
- The fragment Cell mounts with an incomplete slice and renders its `Loading`.
- When the deferred patch lands in the cache, the live `useFragment` binding
  flips `complete` to `true` and the Cell re-renders `Success`.

The runtime is already shaped for this: the fragment Cell reads through the
client-agnostic `useFragment` hook and distinguishes complete from incomplete
reads. The main work is: allowing/detecting `@defer` spreads, rendering
`Loading` (instead of falling back to the passed-in data snapshot) when the
slice is
knowingly deferred, and e2e coverage. Deferred patches can also carry errors for
their fragment, which dovetails with the `Failure` story below.

## Why fragment Cells have no `Failure` today

GraphQL errors are request-scoped, and the request belongs to the parent. With
Apollo's default `errorPolicy: 'none'`, any field error poisons the whole result
and the parent's `Failure` renders — no child ever mounts. That's coarse: an
error in just the author resolver takes down the entire post view.

The ingredients for finer-grained handling exist but aren't wired up:

- With `errorPolicy: 'all'` the client receives partial `data` (the errored
  slice is `null`) plus an `errors` array where each error carries a `path`
  (e.g. `["post", "author"]`).
- The hard part is correlation: a fragment Cell receives a detached object and
  doesn't know its own path in the response, while the errors live in the
  parent's query result. Delegating a slice failure to the child's `Failure`
  requires the parent Cell to expose its errors (e.g. via context around
  `Success`) and the child to match errors whose `path` points at its slice.
- Smaller gap, worth fixing sooner: a `null`/missing slice currently makes the
  fragment Cell throw. Routing it to `Empty` (or `Failure` if exported) would
  let a parent using `errorPolicy: 'all'` at least delegate the _rendering_ of a
  failed slice.

## How the Apollo nullability spec changes this picture

The client-controlled nullability spec
(https://specs.apollo.dev/nullability/v0.4/) standardizes exactly the semantics
this needs:

- **`@semanticNonNull`** (schema): declares a field "null only if there is a
  matching error". This removes the ambiguity at the heart of the
  `Empty`-vs-`Failure` question. Today, when a fragment Cell receives a `null`
  slice we can't tell "legitimately absent" from "errored". With semantic
  nullability the routing rule becomes principled:
  - semantically-non-null field is `null` → there _was_ an error → `Failure`
  - plain nullable field is `null` → genuine absence → `Empty`
- **`@catch(to: RESULT)`** (query): the parent can catch errors _at the spread
  position_, receiving a result object (value or error) for that slice instead
  of null-propagation up the tree. That is precisely the delegation mechanism:
  the parent passes the caught result to the fragment Cell, which renders
  `Success` with the value or `Failure` with the error — no bespoke
  error-path/context plumbing needed.
- **`@catchByDefault`** lets an app choose a global policy, which maps nicely
  onto a Cedar convention (e.g. fragment Cell spreads catch to RESULT by default
  once supported).

Caveat: as of mid-2026 the spec is experimental and primarily implemented in
Apollo Kotlin; Apollo Client (JS) support is still emerging, as is the GraphQL
working group's upstream semantic-nullability effort
(https://github.com/graphql/graphql-wg/blob/main/rfcs/SemanticNullability.md).
Until the JS client processes `@catch`, an interim Cedar implementation could
approximate it with `errorPolicy: 'all'` + error-path matching via context from
the parent Cell — and swap to the standardized directives when they land.

## Developer experience follow-ups

The fragment spread in the parent's QUERY is the part developers have to
remember. Safety nets that exist today: the GraphQL VSCode extension (via the
app's graphql.config) autocompletes and validates fragment spreads, a typo'd
spread fails type generation with file/line, and a forgotten spread surfaces
as a TypeScript error at the component usage site (the fragment Cell's data
prop is typed with the full fragment type). Planned improvements:

1. A rule in `@cedarjs/eslint-plugin`: if a Cell file imports a fragment Cell
   and renders it, its QUERY must spread that Cell's fragment. Autofix inserts
   the spread. Works in every editor and in CI without GraphQL tooling.
2. `yarn cedar g cell <name> --fragment` to scaffold a fragment Cell and
   print (or insert) the spread snippet for a chosen parent.
3. Consider adopting `@graphql-eslint` for general in-editor GraphQL
   validation through ESLint.
4. Long term: the build-time query assembler from the original plan document
   (the vite plugin walks the Cell tree and injects fragment spreads
   automatically), which removes the hand-written spread entirely.

## Suggested order of attack

1. ~~Route `null`/missing slices to `Empty` instead of throwing.~~ Done in
   #2107 together with the fragment-named data prop: a `null` data prop
   renders `Empty` (or `Success` with `null` data when there's no `Empty`);
   an entirely missing prop still throws a developer-error naming the prop.
2. The `@cedarjs/eslint-plugin` rule for fragment spreads (DX item 1 above).
3. Parent-provided error context + path matching → fragment Cell `Failure` for
   partial errors (`errorPolicy: 'all'`).
4. `@defer` spreads → fragment Cell `Loading` (and deferred-patch errors →
   `Failure`).
5. Adopt `@semanticNonNull`/`@catch` semantics when Apollo Client (JS) supports
   them, replacing the interim correlation logic.
