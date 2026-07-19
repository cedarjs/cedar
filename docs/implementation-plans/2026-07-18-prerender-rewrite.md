# Prerender Rewrite: Vite Environments + Apollo `prerenderStatic`

**Date:** 2026-07-18 **Author:** Tobbe (with Claude) **Status:** Proposal

Supersedes
[2026-07-17-prerender-vite-migration.md](./2026-07-17-prerender-vite-migration.md),
which covered only the bundler swap. This plan keeps that work (in revised form,
as Track 1) and adds a rewrite of the prerender data/render layer on top of
Apollo Client's modern SSR API (Track 2).

---

## Background

Cedar's prerender (SSG) pipeline predates Apollo Client having a real SSR story,
so Cedar hand-rolled one. The active ESM path (`runPrerenderEsm.tsx`) currently:

1. Bundles `App.tsx` + `Routes.tsx` at build time with a runtime **Rollup +
   SWC** pipeline (`buildAndImport`, 7 custom Rollup plugins)
2. Imports the GraphQL handler through **`NodeRunner`** (a Vite
   `RunnableDevEnvironment`)
3. Renders each route with a custom multi-pass loop: `renderToString` the whole
   app, intercept cell queries via `CellCacheContextProvider` + `queryCache`,
   execute the queries, re-render, repeat until no new queries appear
   (`recursivelyRender`)
4. Renders routes **strictly sequentially** (Listr `concurrent: false`)
5. Shares a module-scope `prerenderApolloClient` across all pages to prepopulate
   the client-side cache

Problems, in order of user impact:

- **Speed:** a page with cells nested D levels deep costs D+1 complete
  `renderToString` passes of the entire app — and pages render one at a time on
  one core.
- **Memory:** the shared Apollo client accumulates cache for every page for the
  life of the process. Large sites grow without bound.
- **Maintenance:** the Rollup plugins duplicate Cedar's Vite plugins, and the
  cell-cache interception machinery duplicates what Apollo Client now ships as a
  supported API.

---

## Decisions Already Made

These were settled during design discussion; recorded here so the tradeoffs
don't get re-litigated.

### Production HTML comes from a build, not a dev server

Prerendering through a Vite dev server / module runner (as suggested in
community discussions) was considered and rejected **for the production
artifact**. Prerendered HTML must hydrate against the production client bundle:

- Asset imports must resolve to the same hashed URLs the deployed client bundle
  uses — dev-mode transforms produce `/src/...` URLs that 404 in production.
- `import.meta.env.PROD` / `NODE_ENV` branches in user code must take the
  production path.
- Plugins that guard on `apply: 'build'` or `command === 'serve'` must behave as
  they do in the client build.

The dev-runner approach is merely _tolerable_ for the **GraphQL handler**
(server-only code; dev transforms never leak into shipped HTML) — which is why
`NodeRunner` isn't a correctness problem in the current architecture. That is
an observation about the status quo, not a decision to keep it: the Track 2
target is **no Vite dev environment anywhere at build time**, with `NodeRunner`
surviving only as a fallback if importing the built API handler proves
infeasible (see 2.1 and open question 4). A dev-server-based _prerender
preview_ inside `cedar dev` remains a good future feature; it is out of scope
here.

### Vite Environment API, not a nested programmatic build

The superseded plan proposed calling `vite build --ssr` programmatically inside
`runPrerenderEsm.tsx` (mergeConfig + temp outDir + import + delete). Instead,
Cedar's Vite plugin will define a **`prerender` environment** alongside the
client environment, built via Vite's builder mode (`environments` + `builder`
config, `vite build --app`; Cedar is on Vite 7.3.5). Benefits:

- Client builds first; the manifest is naturally available to the prerender
  environment's plugins.
- All Cedar plugins apply to both environments from one config — no manual
  plugin list to keep in sync, no `mergeConfig` plumbing.
- The combined App/Routes entry becomes a real Rollup input (a virtual module)
  instead of a temp `.tsx` file written to disk.
- This is the architecture Vite is pushing frameworks toward, and it is the same
  foundation request-time SSR would use later.

### The data layer moves to Apollo `prerenderStatic`

Apollo Client 4 ships `prerenderStatic` from `@apollo/client/react/ssr` — a
supported API that does exactly what Cedar's custom machinery does, better:

| Cedar today (`runPrerenderEsm.tsx`)                       | Apollo `prerenderStatic`                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `CellCacheContextProvider` + `queryCache` intercept cells | Cells run their real `useQuery` against a real client                |
| `recursivelyRender` multi-pass loop                       | Built-in re-render-until-settled with `maxRerenders` guard           |
| `executeQuery` plumbing to the GraphQL handler            | A terminating Apollo link that calls the handler in-process          |
| Module-scope client prepopulation hack                    | Standard `client.extract()` → `__APOLLO_STATE__` → `cache.restore()` |
| Nothing                                                   | `diagnostics: true` waterfall detection, `AbortSignal` timeouts      |

Crucially, `prerenderStatic` supports both cell styles:

- **Classic cells (`useQuery`):** Apollo-managed multi-pass rendering — same
  algorithm as today, but maintained by Apollo.
- **Suspense cells (`createSuspendingCell` / `useBackgroundQuery`):** a **single
  render pass** via `renderFunction: prerenderToNodeStream` (React 19's
  `react-dom/static`). Migrating cells to suspense automatically speeds up
  prerender with no further changes here.

**Verified constraint:** `prerenderStatic` does **not** exist in Apollo Client
3.14.1 (Cedar's current version — its `react/ssr` entry only exports the
deprecated `getDataFromTree` / `getMarkupFromTree` / `renderToStringWithData`).
Track 2 therefore depends on the Apollo Client 4 upgrade. Building on
`getDataFromTree` in the meantime was considered and rejected: it is deprecated,
and we would do the migration twice.

---

## Prerequisites

| Prerequisite             | Needed by | Status                            |
| ------------------------ | --------- | --------------------------------- |
| Vite 7 (Environment API) | Track 1   | ✅ Done (7.3.5)                   |
| Apollo Client 4 upgrade  | Track 2   | ❌ Not started (on 3.14.1)        |
| React 18 support removal | Track 2   | 🔜 Planned (React 19.2.3 in tree) |

Track 1 has no unmet prerequisites and can start now. Track 2 lands after the
AC4 + React 19-only release; it targets `prerenderToNodeStream` directly and
skips the legacy `renderToString` render function entirely.

---

## Track 1 — Replace the Rollup bundler with a Vite `prerender` environment

Keeps the existing render loop (`recursivelyRender`, cell cache) untouched. Only
the way App/Routes get loaded into Node changes.

### 1.1 Define the `prerender` environment

In Cedar's Vite plugin (`packages/vite/src/index.ts`), via the `config` hook,
add:

- `environments.prerender` — a Node-targeted SSR build:
  - input: a virtual entry module (see 1.2)
  - `build.outDir`: `web/dist/prerender`
  - `build.minify: false`, `build.sourcemap: false`,
    `build.reportCompressedSize: false` — the bundle is executed once and
    discarded; skip all output polish
  - `resolve.conditions` / `externalConditions` for Node
- `builder` config so `vite build --app` builds client then prerender, in that
  order (manifest must exist before the prerender environment's asset plugin
  runs — see 1.3).

Gate the environment on prerender being enabled (routes with `prerender`
detected / `cedar build` `--prerender` flag) so plain builds don't pay for it.

### 1.2 Virtual entry module

Replace the temp-file entry (`runPrerenderEsm.tsx` currently writes a combined
`.tsx` that re-exports `App`, `Routes`, `CellCacheContextProvider`,
`LocationProvider`) with a `virtual:cedar-prerender-entry` module resolved by a
small plugin, applied only in the `prerender` environment. Same exports as today
— Track 1 does not change the runtime contract.

### 1.3 Asset URL correctness

The requirement: asset URLs in prerendered HTML must be the same URLs the
deployed client build serves. How they get there is an implementation choice
with two candidates, in order of preference:

**(a) Vite-native (preferred — verify first).** In the `prerender` environment,
Vite's own asset pipeline resolves media imports to content-hashed URLs using
the same naming logic as the client build. Hashes are derived from file content
and both environments share one config, so the URLs should match the client
build's exactly, with zero Cedar code (`build.ssrEmitAssets` defaults to
`false`, so the prerender build references the URLs without writing duplicate
files). Write a test that builds a fixture with media imports in both
environments and asserts the prerender bundle's asset URLs appear in the client
manifest. Known risks to check: `assetsInlineLimit` behaving differently across
environments, and non-default `assetFileNames` / `base` settings.

**(b) Manifest mapping (fallback).** Only if (a) has holes: port
`rollup-plugin-cedarjs-prerender-media-imports` to a Vite plugin scoped to the
`prerender` environment — map media imports to the client manifest, falling
back to data URLs. The manifest name/location is Cedar's own choice, set in
`packages/vite/src/lib/getMergedConfig.ts`
(`build.manifest: 'client-build-manifest.json'`) and already consumed by
`buildRouteManifest.ts`, `serve.ts`, and `runFeServer.ts` — it is stable under
this rewrite, but any new code should read the name from shared config rather
than hardcode the string.

The old Rollup plugin existed because the standalone Rollup pipeline had no
asset handling at all. The Vite environment has one — so (b) is a fallback,
not the default carried forward from the old architecture.

### 1.4 Plugin disposition (from the old plan's mapping table)

| Rollup plugin                                       | Disposition                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `rollup-plugin-cedarjs-cell`                        | Covered by `cedarCellTransform` (shared config)                                                   |
| `rollup-plugin-cedarjs-directory-named-imports`     | Covered by existing Vite plugin (shared config)                                                   |
| `rollup-plugin-cedarjs-routes-auto-loader`          | Covered by `cedarRoutesAutoLoaderPlugin` — must run in prerender mode (open question 1)           |
| `rollup-plugin-cedarjs-inject-file-globals`         | Not needed — Vite SSR build handles natively                                                      |
| `rollup-plugin-cedarjs-external`                    | Not needed — SSR build externalizes node_modules                                                  |
| `rollup-plugin-cedarjs-ignore-html-and-css-imports` | Vite handles CSS natively; thin styles-only stub plugin if edge cases remain                      |
| `rollup-plugin-cedarjs-prerender-media-imports`     | Likely not needed — Vite-native asset resolution preferred; port only as fallback (1.3)           |
| `rollup-plugin-cedar-remove-dev-fatal-error-page`   | Already exists as `cedarRemoveDevFatalErrorPage` in `packages/vite/src/plugins/` — no port needed |

### 1.5 Wire up and clean up

- `runPrerenderEsm.tsx`: replace `buildAndImport(...)` with importing the built
  prerender bundle from `web/dist/prerender` (the build now happens during
  `vite build --app`, orchestrated by the CLI's existing `buildHandler.ts` →
  `triggerPrerender` flow — prerender execution stays in the CLI, the builder
  only produces artifacts).
- Delete `packages/prerender/src/build-and-import/` (bundler + all 7 Rollup
  plugins).
- Remove from `packages/prerender/package.json`: `rollup`, `rollup-plugin-swc3`,
  `@swc/core`, `@rollup/plugin-alias`, `@rollup/plugin-commonjs`,
  `@rollup/plugin-node-resolve`, `@rollup/plugin-replace`. Regenerate the
  lockfile.

---

## Track 2 — Replace the custom data/render layer with `prerenderStatic`

Lands after the Apollo Client 4 upgrade and React 18 removal. Deletes Cedar's
prerender-specific data machinery in favor of Apollo's supported API.

### 2.1 Per-route rendering

```ts
import { prerenderStatic } from '@apollo/client/react/ssr'
import { prerenderToNodeStream } from 'react-dom/static'

// per route:
const client = new ApolloClient({
  ssrMode: true,
  link: inProcessGqlLink,
  cache: new InMemoryCache(),
})

const { result } = await prerenderStatic({
  tree: (
    <LocationProvider location={new URL(prerenderUrl)}>
      <App>
        <Routes />
      </App>
    </LocationProvider>
  ),
  context: { client },
  renderFunction: prerenderToNodeStream,
  diagnostics: process.env.CEDAR_PRERENDER_DIAGNOSTICS === '1',
  signal: AbortSignal.timeout(PER_ROUTE_TIMEOUT_MS),
})

const apolloState = client.extract()
```

- `inProcessGqlLink` is the one remaining piece of Cedar glue: a terminating
  Apollo link that invokes the GraphQL handler directly (no HTTP). First choice:
  import the **built API handler** from `api/dist` (already built at this point
  in `cedar build`; zero transform cost, no Vite server anywhere at build time).
  Fallback if env-loading/side-effect issues surface: keep `NodeRunner`
  (`packages/prerender/src/graphql/node-runner.ts`) as the loader behind the
  same link.
- Inject `apolloState` into the HTML as `window.__APOLLO_STATE__`; the web side
  restores it with `cache.restore()` on boot. This replaces Cedar's cell-cache
  serialization. Classic `useQuery` cells hit the restored cache and render data
  immediately on hydration — no client streaming/Suspense support required, so
  this does not depend on Cedar's experimental streaming work.

### 2.2 Orchestration: concurrency and memory

- Render routes with **bounded concurrency** (start with `min(4, cores)`;
  rendering is CPU-bound, GraphQL execution is I/O-bound — they overlap).
  Replace the `concurrent: false` for-loop in
  `packages/cli/src/commands/prerenderHandler.ts`.
- **Per-route Apollo client** (as above) instead of the shared module-scope
  client — memory becomes O(largest page), not O(site).
- Optional, profile first: a shared response-level LRU keyed on (query,
  variables) to dedupe layout/nav queries repeated on every page.
- Stream HTML to disk (`prerenderToNodeStream` output → file write stream)
  instead of accumulating strings.

### 2.3 Deletions

- `recursivelyRender`, `executeQuery`, `queryCache` handling, and the
  module-scope `prerenderApolloClient` in `runPrerenderEsm.tsx`
- The prerender interception path of `CellCacheContextProvider` in
  `@cedarjs/web` (`packages/web/src/components/cell/CellCacheContext.tsx`) —
  check nothing else depends on it before removal
- `runPrerender.tsx` (legacy Babel/CJS path) — React 18 removal is the natural
  point to delete it along with its babel plugins

---

## Open Questions

1. **Routes auto-loader prerender mode.** `cedarRoutesAutoLoaderPlugin` has a
   client mode (lazy `import()`, populates
   `globalThis.__REDWOOD__PRERENDER_PAGES`) and a prerender mode (direct
   imports). For Track 1, verify the `prerender` environment triggers the
   prerender mode — with the Environment API this can key off
   `this.environment.name`. For Track 2, question whether the prerender mode is
   needed at all: Suspense-aware `prerenderToNodeStream` resolves `React.lazy`
   route imports during rendering, so the client-mode output may just work —
   which would let the prerender mode and the
   `globalThis.__REDWOOD__PRERENDER_PAGES` global be deleted entirely.
2. **Cell query observability.** Cedar cells call Apollo's hooks directly (the
   old `GraphQLHooksProvider` indirection has been removed). `prerenderStatic`
   should observe queries transparently — verify with a test early in Track 2,
   before building on it.
3. **`ssr.external` / CJS-only packages.** Rollup's `externalPlugin` had nuanced
   logic for keeping some `@cedarjs/*` workspace packages bundled. Vite's SSR
   externalization should handle this; test against packages that ship only CJS.
4. **Built API handler import (2.1).** Confirm the `api/dist` handler can be
   imported standalone (env loading, side effects, Prisma client init). If not,
   `NodeRunner` stays.
5. **Builder-mode UX.** Users' `web/vite.config.ts` just includes the `cedar()`
   plugin, so the environment definition is under Cedar's control — but confirm
   `vite build --app` integrates cleanly with the CLI's current `execa`-based
   web build invocation, and that non-prerender builds are not slowed down.
6. **Concurrency default.** Validate the worker count against real projects —
   renderToString-era assumptions about shared module state (e.g. singletons in
   user code) may surface under concurrent rendering in one process. If
   user-code global state is a problem, fall back to worker threads with
   per-worker module instances.

---

## Relationship to Future SSR

- **SSG (this plan):** `prerender` environment bundle + `prerenderStatic` at
  build time → static HTML + `__APOLLO_STATE__`.
- **Request-time SSR (future):** same environment/bundle foundation, but
  rendered per request — with `@apollo/client-react-streaming` (already used by
  Cedar's experimental streaming support) instead of `prerenderStatic`.

Both share the client setup and the build artifact, so neither track here needs
revisiting when SSR lands.

---

## Files Affected

**Track 1 — new/modified:**

- `packages/vite/src/index.ts` — `prerender` environment + builder config
- `packages/vite/src/plugins/vite-plugin-cedar-prerender-entry.ts` (virtual
  entry, new)
- `packages/vite/src/plugins/vite-plugin-cedar-prerender-media-imports.ts`
  (port, new)
- `packages/prerender/src/runPrerenderEsm.tsx` — import built bundle
- `packages/cli/src/commands/build/buildHandler.ts` — `vite build --app`
  invocation

**Track 1 — deleted:**

- `packages/prerender/src/build-and-import/` (entire directory)
- Rollup/SWC dependencies in `packages/prerender/package.json`

**Track 2 — modified:**

- `packages/prerender/src/runPrerenderEsm.tsx` — `prerenderStatic`-based
  renderer
- `packages/cli/src/commands/prerenderHandler.ts` — concurrent route
  orchestration
- `packages/web/src/components/cell/CellCacheContext.tsx` — remove prerender
  interception
- `packages/web` bootstrap — `__APOLLO_STATE__` restore

**Track 2 — deleted:**

- `packages/prerender/src/runPrerender.tsx` + `babelPlugins/` (legacy path, with
  React 18 removal)
- `packages/prerender/src/graphql/node-runner.ts` (if open question 4 resolves
  in favor of built-handler import)

---

## What This Does NOT Cover

- The Apollo Client 4 upgrade itself (prerequisite, separate effort)
- React 18 support removal (prerequisite, separate effort)
- The RSC build — it is being completely rewritten, so nothing in this plan
  should follow or preserve current patterns from it
- Request-time SSR and client-side streaming/Suspense — future work this enables
- A dev-server-based prerender preview in `cedar dev` — worthwhile future
  feature, distinct from the production pipeline
