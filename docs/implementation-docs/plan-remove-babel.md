# Plan: Remove Babel from CedarJS

This document gives a high-level overview of the steps needed to fully remove Babel
from the framework, and the order we want to tackle them in.

A detailed handover document for step 1 already exists at
`docs/handover-babel-to-typescript-eslint.md`.

## Out of Scope

The following areas have already been handled separately and do not need to be
addressed here:

- **Jest** — being replaced by Vitest
- **Vite RSC plugins** — being replaced as part of a separate RSC rework

---

## Step 1 — ESLint Config (start here)

**Packages:** `packages/eslint-config`, `eslint.config.mjs` (repo root)

Replace `@babel/eslint-parser` and `@babel/eslint-plugin` with
`@typescript-eslint/parser` (already installed) across both the flat config
(`shared.mjs`, `index.mjs`) and the legacy CJS config (`shared.js`, `index.js`).
This removes `@cedarjs/babel-config` as a dependency of `packages/eslint-config`.

This is the right place to start because it is fully self-contained, low-risk
(linting only), and represents the first time a package drops its `babel-config`
dependency entirely.

See `docs/handover-babel-to-typescript-eslint.md` for full details.

---

## Step 2 — AST Analysis Utilities

**Packages:** `packages/internal`, `packages/cli`, `packages/codemods`

Several packages share near-identical utility code that uses `@babel/parser` and
`@babel/traverse` to parse source files and walk their ASTs — extracting named
exports, default exports, GraphQL queries, JSX elements, and Cell metadata.

The key files are:

- `packages/internal/src/ast.ts` — canonical copy, used by the framework
- `packages/internal/src/jsx.ts` — JSX element extraction
- `packages/cli/src/testLib/cells.ts` — duplicate of the above for CLI use
- `packages/codemods/src/lib/cells.ts` — another near-duplicate

Replace `@babel/parser` + `@babel/traverse` with a parser that is already present
in the dependency graph or is a clear upgrade. The best candidate is
`@typescript-eslint/parser` (for pure parse + walk tasks) or `oxc-parser` (faster,
no traversal API needed for simple cases). For traversal, `es-tree` compatible
walkers like `estree-walker` are lightweight and parser-agnostic.

This step is worth doing early because `packages/internal` re-exports everything
from `@cedarjs/babel-config` (see `packages/internal/src/index.ts`), which means
every consumer of `@cedarjs/internal` transitively depends on Babel. Fixing this
cuts the blast radius of subsequent steps significantly.

The duplicate Cell analysis code in `cli` and `codemods` should be consolidated
onto the `internal` implementation at the same time.

---

## Step 3 — TypeScript-to-JavaScript Transform

**Packages:** `packages/internal`, `packages/codemods`, `packages/cli`,
`packages/create-cedar-app`

Several places use `@babel/core` with `@babel/plugin-transform-typescript` purely
to strip TypeScript types and produce JavaScript — with no other transforms applied.
This is one of Babel's most replaceable use cases.

The key files are:

- `packages/internal/src/ts2js.ts` — used by the CLI's `ts-to-js` command
- `packages/codemods/src/lib/ts2js.ts` — duplicate
- `packages/cli/src/lib/index.js` (`transformTSToJS`) — used during code generation
  to convert `.ts` templates to `.js` when the user has a JS project
- `packages/create-cedar-app/scripts/tsToJS.js` — used to produce the JS starter
  template from TypeScript sources

Replace all of these with either `oxc-transform` or the TypeScript compiler API
(`ts.transpileModule`), both of which can strip types without a full Babel pipeline.
The `ts2js` implementations in `internal` and `codemods` should be consolidated at
the same time.

Note that the Prettier `parser` strings of `'babel'` and `'babel-ts'` that appear
alongside these transforms (in `prettify` helpers across `internal`, `codemods`,
and `cli`) can be changed to `'babel'` → `'espree'` / `'babel-ts'` → `'typescript'`
as part of this step — they are trivial one-line changes.

---

## Step 4 — API Build Pipeline

**Packages:** `packages/internal`, `packages/vite`, `packages/cli-packages/dataMigrate`

The API build uses esbuild for bundling but threads every file through a Babel
transform first (via `transformWithBabel`) in order to apply the custom Cedar
plugins: context wrapping, OTel wrapping, job path injection, GraphQL options
extraction, and module resolution.

The key files are:

- `packages/internal/src/build/api.ts` — the esbuild plugin that calls
  `transformWithBabel`
- `packages/vite/src/buildRouteHooks.ts` — uses the same pattern for route hook
  builds
- `packages/babel-config/src/api.ts` — `transformWithBabel` itself, and
  `getApiSideBabelPlugins`

The custom Babel plugins that are applied during this step need to be rewritten
as esbuild plugins (or a single combined esbuild plugin) so the Babel transform
layer can be removed entirely. The transforms themselves are not complex —
they do AST manipulation that can be reproduced with a lighter-weight approach.
Consider `oxc-transform` or direct string/regex transforms for the simpler ones
(e.g. `remove-dev-fatal-error-page`), and proper AST transforms for the more
complex ones (e.g. `otel-wrapping`, `context-wrapping`).

`packages/cli-packages/dataMigrate/src/commands/upHandler.ts` also calls
`registerApiSideBabelHook` to transpile data migration files on the fly. This
can be replaced with `tsx` or `@swc-node/register` once the custom plugins are
handled.

---

## Step 5 — CLI Runtime Hooks (`exec` and `console` commands)

**Package:** `packages/cli`

The `exec` and `console` commands use `@babel/register` (via
`registerApiSideBabelHook` / `registerWebSideBabelHook`) to patch Node's `require`
and transpile files on the fly when the user runs arbitrary scripts or opens the
REPL.

The key files are:

- `packages/cli/src/lib/execBabel.js` — `configureBabel()`, used by `exec`
- `packages/cli/src/commands/consoleHandler.ts` — REPL setup

Replace `@babel/register` with `tsx` (which registers a similar require hook using
esbuild under the hood) or `@swc-node/register`. Both support TypeScript, JSX,
and path aliases out of the box with minimal configuration.

The module-resolver aliases that are currently passed to `babel-plugin-module-resolver`
in these hooks will need to be replicated in the new approach — `tsx` supports this
via `tsconfig.json` path mappings, which Cedar already maintains.

---

## Step 6 — Prerender

**Package:** `packages/prerender`

Prerender is the most complex consumer of Babel in the codebase. It uses
`@babel/register` hooks for both the API side and the web side to transpile and
`require()` user code at render time, and it applies two Cedar-specific Babel
plugins on top of the standard config:

- `babelPluginRedwoodCell` — transforms Cell components for SSR
- `babelPluginRedwoodPrerenderMediaImports` — rewrites media imports to no-ops

The key file is `packages/prerender/src/runPrerender.tsx`. There is also a Rollup
plugin (`rollup-plugin-cedarjs-cell.ts`) that uses `@babel/parser`, `@babel/traverse`,
and `@babel/generator` for the same Cell transformation in the Rollup-based build
path.

This step is last because it has the most moving parts: both the on-the-fly
transpilation and the two custom plugin transforms need to be replaced at once for
prerender to remain functional. The `@babel/register` portion can follow the same
approach as step 5 (`tsx` / `@swc-node/register`), and the two Babel plugins should
be rewritten as Rollup/Vite transform hooks.

---

## Step 7 — Retire `packages/babel-config`

Once all the above steps are complete, `@cedarjs/babel-config` will have no
remaining consumers inside the framework. At that point:

- Delete `packages/babel-config` entirely
- Remove `@cedarjs/babel-config` from `packages/internal/src/index.ts` (which
  currently re-exports everything from it)
- Clean up any remaining `babel.config.js` files in the repo and fixture projects
- Remove all remaining Babel-related entries from the root `package.json`

---

## Dependency Removal Tracker

As a rough guide, here is when each Babel dependency can be dropped:

| Dependency                                                                                                                                     | Can be removed after step |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `@babel/eslint-parser`, `@babel/eslint-plugin`, `eslint-plugin-babel`, `eslint-import-resolver-babel-module`                                   | 1                         |
| `@babel/parser`, `@babel/traverse`, `@babel/types` (in `internal`, `cli`, `codemods`)                                                          | 2                         |
| `@babel/core`, `@babel/plugin-transform-typescript` (ts2js usages)                                                                             | 3                         |
| `@babel/plugin-transform-react-jsx`, `@babel/preset-env`, `@babel/preset-typescript`, `babel-plugin-module-resolver` (API build)               | 4                         |
| `@babel/register`, `babel-plugin-module-resolver` (CLI hooks)                                                                                  | 5                         |
| `@babel/core`, `@babel/register`, `babel-plugin-*` (prerender)                                                                                 | 6                         |
| `@cedarjs/babel-config`, `@babel/cli`, `@babel/node`, `@babel/generator`, `babel-jest`, `babel-plugin-graphql-tag`, `babel-plugin-auto-import` | 7                         |
