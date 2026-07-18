# Fragment Cells (Query Aggregation) — Implementation Notes

**Context:** PR #2107 (`feat(cells): Add fragment Cells for query aggregation`)

Decision record and gotchas from the implementation. The user-facing docs live
in `docs/docs/cells.md` ("Fragment Cells: Aggregating Queries") and the planned
follow-up work (`@defer`, partial errors, nullability directives, DX
improvements) in
`docs/implementation-plans/fragment-cells-defer-and-partial-errors.md`. This
document covers what's _not_ in either: how the pieces fit together and why
they're shaped the way they are.

---

## Architecture: three layers

1. **Client-agnostic hook slot.** `GraphQLHooksProvider` gained an _optional_
   `useFragment` slot (`FragmentHookOptions` → `FragmentHookResult`). It's
   optional on purpose: `GraphQLHooksProvider` is public API used by
   bring-your-own-GraphQL-client setups, and a new required prop would have been
   a breaking change for them. When absent, a fallback implementation always
   reports `{ data: undefined, complete: false }`.
2. **Apollo adapter.** `useCellFragment` in
   `packages/web/src/apollo/fragmentRegistry.ts` adapts Apollo's `useFragment`
   to that shape. All Apollo-specific imports stay in the `apollo/` directory;
   `createFragmentCell` only talks to the hook slot.
3. **The Cell runtime.** `createFragmentCell` always calls the hook
   (rules-of-hooks), then picks: complete cache read → live data; incomplete →
   the data snapshot passed in via the Cell's data prop. This fallback is what
   makes fragment Cells work when there is no usable Apollo cache: prerendering,
   jest/Storybook mocks, custom GraphQL clients, and fragments that don't select
   the type's key fields all take the snapshot path.

The snapshot fallback is only possible because Apollo's `dataMasking` is off
(Cedar default): the parent's query result contains the fragment's fields
inline, so the object passed as the data prop is self-sufficient. If Cedar ever
enables data masking, the fallback breaks and the cache read becomes
load-bearing.

## Why the fragment registry does the heavy lifting

The magic of "spread by name, no import needed" is Apollo's
`createFragmentRegistry`: both Redwood Apollo providers pass
`fragments: fragmentRegistry` to `InMemoryCache`, which transforms outgoing
documents and inlines any registered fragment definition whose name is spread.
`createCell()` registers the `FRAGMENT` at module-evaluation time, and because a
parent must import the child Cell to render it, registration is guaranteed to
happen before the parent's query is built. No build-time step is involved in
resolving the spread at runtime — the four cell transforms only decide _that_ a
file is a cell, not how fragments resolve.

Two registration decisions that took iteration (both flagged by Greptile on the
PR):

- `QUERY` takes precedence over `FRAGMENT` when a Cell exports both (matching
  mirror type generation), so a fragment export can be a helper for other Cells
  without changing the Cell's own behavior.
- But that helper fragment must _still be registered_, otherwise a name-only
  spread of it reaches the server unresolved. `createCell` registers the
  fragment even on the query-Cell path.

Note: the streaming-SSR provider (`apollo/suspense.tsx`) previously did not wire
its `InMemoryCache` to the fragment registry at all — that was a latent gap
fixed in this PR. If a third provider is ever added, it needs both
`fragments: fragmentRegistry` on the cache and the `useFragment` hook prop.

## The Apollo `useFragment` trap (the one real bug found in verification)

Apollo's `useFragment` with a `from` object it cannot identify (e.g. the
fragment doesn't select `id`) logs a dev warning **and returns
`{ data: {}, complete: true }`** — a _complete_ empty result. That defeated the
"fall back on incomplete reads" logic and rendered empty components; unit tests
didn't catch it (they mock the hook), only real-browser verification did. The
fix in `useCellFragment`: call `client.cache.identify()` ourselves, and when it
returns `undefined`, pass a sentinel string ref
(`CedarUnidentifiableFragmentRef:_`) — which identifies nothing, avoids the
warning — and force the incomplete path. Rule of thumb: never trust
`complete: true` from Apollo unless you identified the object yourself.

Related: the live-cache-read path only works when the fragment selects the
type's key fields (default `id`), because an id-less selection can't be
normalized or identified. That's why the docs recommend including `id` — with
it, the entity normalizes and the Cell re-renders on cache updates from
mutations/other queries; without it, the Cell is snapshot-only.

## The data prop name is derived in two places

`AuthorCell_author` → `author` (substring after the last underscore), else
camelCased type condition (`on User` → `user`). This derivation exists twice and
must stay in sync (both sites carry cross-referencing comments):

- `getFragmentPropName` in
  `packages/web/src/components/cell/createFragmentCell.tsx` (runtime)
- `parseGqlFragmentPropName` in `packages/internal/src/gql.ts` (mirror type
  generation)

They can't easily share code: `internal` works on GraphQL source strings at
generate-time, `web` on DocumentNodes at runtime, and neither package should
depend on the other for this.

The prop-name symmetry (parent passes `author` in, `Success` receives `author`
out) is what makes the missing-spread failure mode self-diagnosing: the mirror
types the input prop with the codegen fragment type, so a parent whose QUERY
lacks the spread gets a TypeScript error listing the missing fields at the JSX
usage site. This was verified empirically — see the DX section of the
future-work doc.

## Type generation details

- graphql-codegen is configured with `namingConvention: 'keep'` and
  `omitOperationSuffix: true`, so the generated type for fragment
  `AuthorCell_author` is named exactly `AuthorCell_author`. The mirror template
  imports it by that name. If codegen naming config ever changes, the fragment
  mirror template breaks.
- Mirror templates (`packages/internal/src/generate/templates/*.template`) are
  evaluated as **JavaScript template literals** (`templates.ts` wraps the file
  content in backticks and `new Function`s it). Consequence: template files must
  not contain backticks — a code example in a JSDoc comment inside the template
  caused a `SyntaxError` at generate time. `${...}` is interpolation; everything
  else, including `{foo}` JSX braces, is fine.
- `isCellFile` in `packages/internal/src/files.ts` needed no change: it already
  accepts files exporting `Success` without `QUERY`.

## The four (not one) cell transforms

"The cell transform" is actually four near-identical copies, and all four needed
the `FRAGMENT` export added:

| Copy                                                                                  | Used by                       |
| ------------------------------------------------------------------------------------- | ----------------------------- |
| `packages/vite/src/plugins/vite-plugin-cedar-cell.ts`                                 | vite dev/build, and Storybook |
| `packages/prerender/src/babelPlugins/babel-plugin-redwood-cell.ts`                    | prerender                     |
| `packages/prerender/src/build-and-import/rollupPlugins/rollup-plugin-cedarjs-cell.ts` | prerender build-and-import    |
| `packages/testing/src/config/jest/babelPlugins/babel-plugin-redwood-cell.ts`          | jest                          |

Storybook does _not_ have a fifth copy — `storybook-framework-cedarjs` runs the
vite plugin pipeline. The babel-plugin copies are tested with
`babel-plugin-tester` fixtures (`__fixtures__/cell/*/code.js`); the runner
auto-generates a missing `output.js` on first run, which is the easiest way to
add a fixture.

## TypeScript quirks worth remembering

- Bindings destructured in a **parameter list** don't keep control-flow
  narrowing inside closures. `createCell`'s factories destructure `QUERY` in the
  signature, so an `if (!QUERY) throw` guard doesn't narrow `QUERY` inside the
  returned component. Fix: re-assign to a `const` after the guard
  (`const cellQuery = QUERY`) — `const` narrowing _does_ survive into closures.
- `createSuspendingCell` types its argument with `Record<string, unknown>`
  instead of its own `CellProps` generic (pre-existing workaround), which makes
  a generic-to-generic call from `createCell` fail contravariance checks on
  `beforeQuery`. The dispatch in `createCell` casts the props for that branch
  and re-types the returned component.

## Testing and verification map

- **Runtime unit tests**: `createFragmentCell.test.tsx` mocks the hook slot via
  `GraphQLHooksProvider` — it intentionally never touches Apollo, so the Apollo
  adapter is _only_ covered by browser/e2e tests.
- **Typegen**: `example-todo-main` gained `TodoStatusCell` (a fragment cell) to
  drive mirror-generation and codegen snapshot tests in `@cedarjs/internal`. Run
  those tests from `packages/internal` as cwd — one snapshot ("mirror path for
  directory named modules") encodes a cwd-relative path and rewrites itself
  wrongly if `vitest -u` runs from the repo root.
- **e2e**: both test-project fixtures (CJS + ESM) contain `AuthorFragmentCell` +
  `AggregatedBlogPostCell` + `/aggregated-blog-post/{id:Int}`; the
  `tasks/test-project` scripts generate the same files from
  `tasks/test-project/templates/web/`, and the "Check test-project fixture" CI
  job enforces byte-exact parity between the two. The Playwright spec
  (`tasks/smoke-tests/shared/aggregatedCells.ts`) asserts the fragment was
  inlined into the request and that no separate author query fired — but
  deliberately **not** an exact request count, because React 18 fires the same
  query twice on mount (React 19 doesn't).
- The `storybook.spec.ts` sidebar locators are substring-sensitive: adding
  `AggregatedBlogPostPage` broke `text=BlogPostPage`. Use word-boundary regexes
  (`text=/\bBlogPostPage\b/`) for story names.
