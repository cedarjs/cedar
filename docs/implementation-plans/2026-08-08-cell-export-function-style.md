# Cell exports: migrate to `export function` style

Plan for changing all Cell exports — `Loading`, `Empty`, `Failure`, `Success`,
`beforeQuery`, `afterQuery`, `isEmpty` — from const arrow functions to function
declarations in generator templates, docs, and fixtures. This document also
records the typing reasoning that led here, because the style decision and the
type-annotation strategy constrain each other.

## Motivation

The larger React ecosystem has moved away from

```tsx
export const MyComponent: React.FC<Props> = ({ myProp }) => {
```

toward

```tsx
export function MyComponent({ myProp }: Props) {
```

Cedar's Cell files still use the const arrow form everywhere. Since the
components in a Cell file should follow the ecosystem, and a generated Cell
reads better when every export uses the same form, the non-component exports
(`beforeQuery` et al.) should move too.

This intersects with an ongoing effort to make Cell types discoverable (see
#2348, #2349, and the `CellBeforeQueryResult` docs work on the
`tobbe-docs-cells-before-query` branch): whichever style we standardize on
determines which annotation patterns we can document and lint toward.

## The typing question

The readability problem that started this thread:

```ts
// TypeScript, annotated inline — hard to read
export const beforeQuery = ({
  page,
}: {
  page?: number | string
}): CellBeforeQueryResult<BlogPostsQueryVariables> => {

// The JS version it competes with
export const beforeQuery = ({ page }) => {
```

Options considered:

### 1. Function type on the const (rejected)

Annotate the const with a framework-exported function type and let contextual
typing handle params and return:

```ts
export const beforeQuery: CellBeforeQuery<BlogPostsQueryVariables> = (
  props,
) => {
```

This is the cleanest arrow-style option (the arrow itself stays identical to
JS), and would have meant adding a `CellBeforeQuery<CellVariables, CellProps>`
function type to `@cedarjs/web`. Rejected for two reasons:

- It is **arrow-only**. A function declaration has no expression to hang a
  function type on, so this pattern dies the moment we migrate to
  `export function`.
- It is the `React.FC` / `GetServerSideProps`-era pattern the ecosystem has been
  walking away from (see precedents below).

Do **not** add `CellBeforeQuery` to `@cedarjs/web`.

### 2. `satisfies` (rejected)

Astro-style `(fn) satisfies GetStaticPaths` only works on expressions. For a
declaration you'd need a separate `beforeQuery satisfies CellBeforeQuery<...>`
statement after the function: errors get reported at the `satisfies` line
instead of inside the function, the inferred return loses excess-property
checking and option autocomplete in the body, and a bare expression statement
looks like a mistake.

### 3. Inline annotations with framework "piece" types (chosen)

Annotate the parameter and return individually, with the framework exporting
types for the pieces (`CellBeforeQueryResult`, `CellSuccessProps`, ...), and
local aliases as the escape hatch when a signature outgrows one line:

```ts
interface BeforeQueryProps {
  page?: number | string
}

type BeforeQueryResult = CellBeforeQueryResult<BlogPostsQueryVariables>

export function beforeQuery({ page }: BeforeQueryProps): BeforeQueryResult {
```

That signature line is 76 characters — under Prettier's 80. The same aliases and
annotations work identically for the const arrow form, so docs written this way
survive the migration untouched. This is what the docs on the
`tobbe-docs-cells-before-query` branch use.

Style note: use `interface` for object shapes and reserve `type` for genuine
aliases (like `BeforeQueryResult` above) — `type` only where `interface` can't
express it (unions, mapped types, aliases of existing types).

## Ecosystem precedents

The closest analogs to `beforeQuery` are the file-convention exports in other
React meta-frameworks, and their trajectory all points the same way:

- **Remix / React Router**: `loader`/`action` are exactly `beforeQuery`-shaped
  (named exports the framework calls with args it defines). Documented style is
  `export async function loader({ request }: LoaderFunctionArgs) {...}`. Remix
  used to push `export const loader: LoaderFunction = ...` and moved away from
  it — for readability, and because inline typing keeps the return type
  inferable (needed by `useLoaderData<typeof loader>`).
- **Next.js**: Pages-era
  `export const getServerSideProps: GetServerSideProps = async (ctx) => {...}`
  was replaced in the App Router by declarations like
  `export async function generateMetadata(props): Promise<Metadata>`.
- **Astro**: went with `satisfies GetStaticPaths` — expression-based, doesn't
  carry over to declarations.

Conclusion: function declaration + inline annotations using framework-exported
piece types is both the ecosystem-consistent and file-consistent choice. Cedar
mirrors Remix by exporting the pieces (`CellBeforeQueryResult`, analogous to
`LoaderFunctionArgs`) rather than whole function types.

## Cedar-specific caveat: the param annotation is load-bearing

Unlike Remix's `loader`, Cedar infers a Cell's **external props** from
`beforeQuery`'s first parameter (`CellPropsVariables` in
`packages/web/src/components/cell/cellTypes.ts` uses
`Parameters<Cell['beforeQuery']>[0]`). So annotating the parameter isn't just
local hygiene — it's what makes `<BlogPostsCell page={1} />` type-check. Docs
and the #2348 lint rule should nudge people toward annotating the parameter even
when they'd otherwise let it slide as implicit-`any`-with-destructuring.

## Work items

1. **Generator templates** (`packages/cli/src/commands/generate/cell/templates/`
   and the list-cell variants): convert `Loading`, `Empty`, `Failure`, `Success`
   to `export function` with inline `CellSuccessProps` / `CellFailureProps`
   annotations. Check the component, page, and scaffold generators for the same
   pattern while at it (separate PRs if scope grows).
2. **Verify the Cell build pipeline handles declarations.** The Babel cell
   transform collects named exports to assemble `createCell(...)`; confirm it
   treats `export function Success() {}` the same as
   `export const Success = () => {}`. Same check for web typegen's mirror
   `.d.ts` generation and the `CellProps` inference chain. Add tests for the
   declaration form where missing.
3. **Docs**: update Cell examples (`cells.md`, `how-to/pagination.md`, tutorial
   chapters, `typescript/utility-types.md`) to the declaration style. The
   beforeQuery examples already use form-agnostic annotations, so they only need
   the `const ... =>` → `function` swap.
4. **Fixtures and test projects**: `__fixtures__/test-project*`,
   `tasks/test-project/`, and any Cell fixtures in package tests.
5. **Lint rule #2348**: must recognize both forms — existing apps keep the arrow
   style indefinitely (this migration is templates/docs only, not breaking). The
   autofix inserts inline param/return annotations, which works on both forms;
   issue updated accordingly.
6. **Generator flag #2349**: the `--before-query` stub should be generated in
   declaration style from the start.

Existing user code in either style keeps working; no codemod is required. An
optional codemod for apps that want to convert wholesale can be considered
later.
