# Moving Prerender to Vite

**Date:** 2026-07-17 **Author:** Lisa (lisa-assistant) **Status:** Proposal

---

## Background

Cedar's prerender (SSG) pipeline currently has two implementations:

1. **`runPrerender.tsx`** — The legacy CJS path. Uses `registerWebSideBabelHook`
   and `require()` to load the web app at build time. Relies heavily on Babel.
2. **`runPrerenderEsm.tsx`** — The active ESM path. A partial migration that
   mixes two different bundlers:
   - **Rollup + SWC** (`buildAndImport`) to bundle and import `App.tsx` +
     `Routes.tsx`
   - **Vite** (`NodeRunner`) to import the GraphQL handler

`buildAndImport` is a runtime Rollup pipeline with 7 Cedar-specific plugins that
bundle the web app on-the-fly, write it to a temp dir under
`web/dist/__prerender`, and immediately `import()` it.

Meanwhile, `NodeRunner` already uses Vite's `RunnableDevEnvironment` and
`env.runner.import()` for the API/GraphQL side — which is essentially the same
job, done the right way.

The goal of this migration is to replace `buildAndImport` with a Vite-based
approach, giving us a single unified toolchain for prerender.

---

## Motivation

- **Remove Rollup and SWC from prerender.** They're only there because
  `buildAndImport` needs them. Once replaced, `rollup`, `rollup-plugin-swc3`,
  and `@swc/core` can be dropped from `@cedarjs/prerender`'s dependencies.
- **Eliminate duplicated plugin code.** The Rollup plugins in
  `build-and-import/rollupPlugins/` are largely duplicates of Cedar's existing
  Vite plugins. After this migration, the Rollup plugin directory can be
  deleted.
- **Reuse Vite's transform pipeline.** Vite already handles TS/JSX transpilation
  (via esbuild), path aliases, and module resolution. We get this for free
  instead of manually wiring it up in Rollup.
- **Unblock removing the SWC dependency** from the monorepo more broadly (also
  used in RSC plugins — separate effort).

---

## Current Architecture

```
runPrerenderEsm.tsx
├── buildAndImport(entryPath)          ← Rollup + SWC
│   ├── rollup-plugin-cedarjs-external
│   ├── rollup-plugin-cedarjs-cell
│   ├── rollup-plugin-cedarjs-directory-named-imports
│   ├── rollup-plugin-cedarjs-ignore-html-and-css-imports
│   ├── rollup-plugin-cedarjs-inject-file-globals
│   ├── rollup-plugin-cedarjs-prerender-media-imports
│   └── rollup-plugin-cedarjs-routes-auto-loader
│   → imports: { App, Routes, CellCacheContextProvider, LocationProvider }
│
└── NodeRunner.importFile(gqlHandlerPath)  ← Vite RunnableDevEnvironment
    ├── cedarCellTransform
    ├── cedarjsResolveCedarStyleImportsPlugin
    ├── cedarjsJobPathInjectorPlugin
    ├── cedarSwapApolloProvider
    ├── cedarCjsCompatPlugin
    ├── cedarImportDirPlugin
    └── cedarAutoImportsPlugin
    → imports: { handler }
```

---

## Target Architecture

Replace `buildAndImport` with a second `NodeRunner` instance (or a more general
`ViteImporter`) configured for the web side:

```
runPrerenderEsm.tsx
├── WebNodeRunner.importFile(entryPath)    ← Vite RunnableDevEnvironment (NEW)
│   ├── cedarCellTransform                ← already exists in @cedarjs/vite
│   ├── cedarDirectoryNamedImportPlugin   ← merged in PR #2089
│   ├── cedarSwapApolloProvider           ← already exists
│   ├── cedarCjsCompatPlugin              ← already exists
│   ├── cedarjsRoutesAutoLoaderPlugin     ← already exists in @cedarjs/vite
│   ├── cedarIgnoreHtmlCssPlugin          ← needs creating (or handle via Vite config)
│   └── cedarPrerenderMediaImportsPlugin  ← needs porting
│   → imports: { App, Routes, CellCacheContextProvider, LocationProvider }
│
└── ApiNodeRunner.importFile(gqlHandlerPath)  ← existing NodeRunner, unchanged
    → imports: { handler }
```

Key insight: `NodeRunner` already does exactly what `buildAndImport` does — it
creates a Vite server with a `RunnableDevEnvironment` and calls
`env.runner.import(filePath)`. We just need a web-side variant with the right
plugin set and alias config.

---

## Rollup Plugin → Vite Equivalent Mapping

| Rollup plugin                                       | Vite equivalent                                                                               | Status                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| `rollup-plugin-cedarjs-cell`                        | `cedarCellTransform()` in `@cedarjs/vite`                                                     | ✅ Exists                  |
| `rollup-plugin-cedarjs-directory-named-imports`     | `cedarDirectoryNamedImportPlugin()`                                                           | ✅ Merged (PR #2089)       |
| `rollup-plugin-cedarjs-routes-auto-loader`          | `cedarjsRoutesAutoLoaderPlugin()` in `@cedarjs/vite`                                          | ✅ Exists (verify API)     |
| `rollup-plugin-cedarjs-external`                    | Vite's `ssr.external` / `resolve.external` config                                             | ✅ Built-in                |
| `rollup-plugin-cedarjs-inject-file-globals`         | Not needed — Vite's SSR runner handles `__dirname`/`__filename` natively in Node environments | ✅ Built-in                |
| `rollup-plugin-cedarjs-ignore-html-and-css-imports` | `css.modules` + Vite's built-in CSS handling, or a small Vite plugin                          | 🔨 Needs creating          |
| `rollup-plugin-cedarjs-prerender-media-imports`     | Port to Vite plugin                                                                           | 🔨 Needs porting           |
| `rollup-plugin-cedar-remove-dev-fatal-error-page`   | Simple Vite transform plugin                                                                  | 🔨 Needs porting (trivial) |

---

## Implementation Steps

### Phase 1 — Create a `WebNodeRunner`

Create `packages/prerender/src/build-and-import/webNodeRunner.ts` (or generalise
`NodeRunner` to accept a side parameter):

```ts
import { createServer, isRunnableDevEnvironment, mergeConfig } from 'vite'
import type { ViteDevServer, RunnableDevEnvironment, UserConfig } from 'vite'

import { getPaths } from '@cedarjs/project-config'
import {
  cedarCellTransform,
  cedarDirectoryNamedImportPlugin,
  cedarSwapApolloProvider,
  cedarCjsCompatPlugin,
  cedarjsRoutesAutoLoaderPlugin,
} from '@cedarjs/vite'

import { cedarIgnoreHtmlCssPlugin } from './vitePlugins/vite-plugin-prerender-ignore-html-css.js'
import { cedarPrerenderMediaImportsPlugin } from './vitePlugins/vite-plugin-prerender-media-imports.js'

export class WebNodeRunner {
  // same shape as NodeRunner, but configured for web side

  async createServer(): Promise<ViteDevServer> {
    return createServer({
      mode: 'production',
      root: getPaths().web.base,
      optimizeDeps: { noDiscovery: true, include: undefined },
      server: { hmr: false, watch: null },
      environments: { nodeRunnerEnv: {} },
      resolve: {
        alias: [{ find: 'src', replacement: getPaths().web.src }],
      },
      plugins: [
        cedarCjsCompatPlugin(),
        cedarCellTransform(),
        cedarDirectoryNamedImportPlugin(),
        cedarjsRoutesAutoLoaderPlugin(),
        cedarSwapApolloProvider(),
        cedarIgnoreHtmlCssPlugin(),
        cedarPrerenderMediaImportsPlugin(),
      ],
    })
  }
}
```

### Phase 2 — Port remaining Rollup plugins to Vite

Two plugins need porting, one is trivial:

**`vite-plugin-prerender-ignore-html-css.ts`:**

```ts
// Replaces rollup-plugin-cedarjs-ignore-html-and-css-imports
// Returns empty modules for .css, .scss, .svg etc. during prerender
export function cedarIgnoreHtmlCssPlugin(): Plugin {
  return {
    name: 'cedar-prerender-ignore-html-css',
    load(id) {
      if (/\.(css|scss|sass|less|svg|png|jpg|gif|ico|webp)(\?.*)?$/.test(id)) {
        return 'export default {}'
      }
    },
  }
}
```

**`vite-plugin-prerender-media-imports.ts`:** Port
`rollup-plugin-cedarjs-prerender-media-imports.ts` — replaces media file imports
with their public URL paths. The Rollup and Vite plugin APIs are compatible
enough that this is mostly a rename.

**`vite-plugin-prerender-remove-dev-fatal-error-page.ts`:** Port
`rollup-plugin-cedar-remove-dev-fatal-error-page.ts` — trivial transform, strips
the dev error page component.

### Phase 3 — Update `runPrerenderEsm.tsx`

Replace the `buildAndImport` call with `WebNodeRunner.importFile()`:

```ts
// Before:
const entryPath = await createCombinedEntry({ appPath, routesPath, outDir })
const required = await buildAndImport({
  filepath: entryPath,
  preserveTemporaryFile: true,
})

// After:
const webRunner = new WebNodeRunner()
await webRunner.init()
const required = await webRunner.importFile(entryPath)
```

The combined entry file trick (creating a temp `.tsx` that re-exports `App`,
`Routes`, etc.) can be kept as-is — it still works fine with Vite's runner.

Alternatively, import each file separately:

```ts
const { default: App } = await webRunner.importFile(getPaths().web.app)
const { default: Routes } = await webRunner.importFile(getPaths().web.routes)
// etc.
```

This avoids the temp file entirely.

### Phase 4 — Clean up

Once `runPrerenderEsm.tsx` no longer uses `buildAndImport`:

- Delete `packages/prerender/src/build-and-import/buildAndImport.ts`
- Delete `packages/prerender/src/build-and-import/rollupPlugins/` (all 7
  plugins)
- Remove from `packages/prerender/package.json`:
  - `rollup`
  - `rollup-plugin-swc3`
  - `@swc/core`
  - `@rollup/plugin-alias`
  - `@rollup/plugin-commonjs`
  - `@rollup/plugin-node-resolve`
  - `@rollup/plugin-replace`
- Regenerate `yarn.lock`

### Phase 5 — Consider consolidating `NodeRunner`

At the end of Phase 1, there are two Vite runner classes with nearly identical
structure (`NodeRunner` for API, `WebNodeRunner` for web). Consider merging them
into a single `ViteNodeRunner` that accepts a side config:

```ts
const apiRunner = new ViteNodeRunner({ side: 'api' })
const webRunner = new ViteNodeRunner({ side: 'web' })
```

This is a nice-to-have, not a blocker.

---

## Open Questions

1. **`renderCache` invalidation:** `runPrerenderEsm.tsx` caches `App` and
   `Routes` between pages. With Vite's runner, we can keep the server alive
   across renders (like `NodeRunner` already does). Need to verify the module
   cache behaviour is equivalent.

2. **`ssr.external` vs Rollup's `externalPlugin`:** The `externalPlugin` has
   nuanced logic for marking node_modules external while keeping certain
   workspace packages internal. Need to verify Vite's SSR externals config
   handles all the same cases. Vite's `ssr.noExternal` pattern matching should
   be sufficient but needs testing.

3. **CJS compat:** `cedarCjsCompatPlugin` is already in `NodeRunner`'s plugin
   list. The web side will need it too (it's included in the proposed
   `WebNodeRunner` above).

4. **`unimport` auto-imports:** `buildAndImport` uses `unimport/unplugin` to
   inject `React` and `gql` globals. The existing `cedarAutoImportsPlugin` in
   the prerender GraphQL directory does something similar — worth checking if it
   can be reused for the web runner, or if the web side actually needs explicit
   auto-imports at all (since `App.tsx`/`Routes.tsx` should already import React
   explicitly with React 19).

5. **Windows paths:** Vite normalizes paths internally, but the web runner's
   `resolve.alias` entries should use `normalizePath()` to be safe.

---

## Files Affected

**New files:**

- `packages/prerender/src/build-and-import/webNodeRunner.ts`
- `packages/prerender/src/build-and-import/vitePlugins/vite-plugin-prerender-ignore-html-css.ts`
- `packages/prerender/src/build-and-import/vitePlugins/vite-plugin-prerender-media-imports.ts`
- `packages/prerender/src/build-and-import/vitePlugins/vite-plugin-prerender-remove-dev-fatal-error-page.ts`

**Modified:**

- `packages/prerender/src/runPrerenderEsm.tsx` — swap `buildAndImport` for
  `WebNodeRunner`
- `packages/prerender/package.json` — remove Rollup/SWC deps, add any missing
  Vite plugin deps

**Deleted:**

- `packages/prerender/src/build-and-import/buildAndImport.ts`
- `packages/prerender/src/build-and-import/rollupPlugins/` (entire directory)

**Eventually:**

- `packages/prerender/src/runPrerender.tsx` — the legacy Babel/CJS path; can be
  deleted once the ESM path is confirmed stable and the CJS build is dropped

---

## What This Does NOT Cover

- Replacing SWC in the RSC Vite plugins (`vite-plugin-rsc-transform-server.ts`,
  `vite-plugin-rsc-analyze.ts`) — separate effort.
- The legacy `runPrerender.tsx` (Babel path) — out of scope here, but this
  migration makes it easier to reason about deleting it.
