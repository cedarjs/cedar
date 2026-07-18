# Moving Prerender to Vite

**Date:** 2026-07-17 **Updated:** 2026-07-18 **Author:** Lisa (lisa-assistant)
**Status:** Proposal

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
`env.runner.import()` for the API/GraphQL side — the same job, done the right
way.

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
  (via esbuild), path aliases, and module resolution — and crucially, Cedar's
  existing web Vite config already has all the necessary Cedar plugins
  configured. We get this for free instead of manually wiring it up in Rollup.
- **Auditability.** A proper SSR build produces an inspectable output artifact
  rather than an opaque in-memory bundle.
- **Alignment with the ecosystem.** This is how SvelteKit and Nuxt implement
  SSG. No major framework invented a separate bundler for prerender.
- **Paves the way for real SSR.** The same `vite build --ssr` artifact used for
  prerender at build time is the same artifact that would be deployed for
  request-time SSR. The migration gets Cedar's prerender and future SSR onto the
  same foundation.

---

## Prerender Is SSG, Not SSR

Cedar's prerender is **SSG** (Static Site Generation): the app is rendered at
**build time** to produce static HTML files. This is distinct from **SSR**
(Server-Side Rendering), where a running server renders HTML at request time for
each user.

The `--ssr` flag in `vite build --ssr` means "build a Node.js-compatible bundle"
(no browser shims), not "set up request-time rendering". What makes the output
SSG vs SSR is how and when you execute it:

- **SSG (Cedar prerender):** execute the bundle once at build time → render all
  routes to `.html` files → discard the bundle
- **SSR (future):** deploy the bundle → execute it on every incoming request →
  return HTML to the client

---

## Current Architecture

```
cedar build
├── vite build                         ← client bundle (existing)
│
└── runPrerenderEsm.tsx
    ├── buildAndImport(entryPath)      ← Rollup + SWC (7 custom plugins)
    │   → imports: { App, Routes, CellCacheContextProvider, LocationProvider }
    │
    └── NodeRunner.importFile(gqlHandlerPath)  ← Vite RunnableDevEnvironment
        → imports: { handler }
```

---

## Target Architecture

Replace `buildAndImport` with a `vite build --ssr` step that reuses Cedar's
existing web Vite config:

```
cedar build
├── vite build                         ← client bundle (unchanged)
│
└── runPrerenderEsm.tsx
    ├── viteSsrBuildAndImport(entryPath)   ← vite build --ssr (NEW)
    │   uses Cedar's existing web vite config (all plugins already present)
    │   → imports: { App, Routes, CellCacheContextProvider, LocationProvider }
    │
    └── NodeRunner.importFile(gqlHandlerPath)  ← existing NodeRunner, unchanged
        → imports: { handler }
```

The key insight: `vite build --ssr` with Cedar's existing web Vite config
automatically applies all Cedar transforms — `cedarCellTransform`,
`cedarAutoImportsPlugin`, `cedarjsRoutesAutoLoaderPlugin`,
`cedarDirectoryNamedImportPlugin`, etc. — without any manual plugin wiring.

---

## Rollup Plugin → Vite Equivalent Mapping

With `vite build --ssr` + Cedar's existing web config, most of the 7 Rollup
plugins become implicit:

| Rollup plugin                                       | Vite equivalent                                                              | Status                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| `rollup-plugin-cedarjs-cell`                        | `cedarCellTransform()` — already in web Vite config                          | ✅ Implicit via existing config        |
| `rollup-plugin-cedarjs-directory-named-imports`     | `cedarDirectoryNamedImportPlugin()` — already in web Vite config             | ✅ Implicit via existing config        |
| `rollup-plugin-cedarjs-routes-auto-loader`          | `cedarjsRoutesAutoLoaderPlugin()` — already in web Vite config               | ✅ Implicit (verify prerender variant) |
| `rollup-plugin-cedarjs-inject-file-globals`         | Not needed — Vite's SSR build handles `__dirname`/`__filename` natively      | ✅ Built-in                            |
| `rollup-plugin-cedarjs-external`                    | `build.ssr` mode automatically externalises node_modules                     | ✅ Built-in                            |
| `rollup-plugin-cedarjs-ignore-html-and-css-imports` | Vite handles CSS natively; small SSR-specific plugin for any edge cases      | 🔨 May need a thin plugin (see below)  |
| `rollup-plugin-cedarjs-prerender-media-imports`     | Vite asset handling converts imports to URLs automatically in SSR build mode | ✅ Likely built-in (verify)            |
| `rollup-plugin-cedar-remove-dev-fatal-error-page`   | Simple Vite transform plugin — trivial port                                  | 🔨 Needs porting (trivial)             |

---

## Implementation Steps

### Phase 1 — Replace `buildAndImport` with `viteSsrBuildAndImport`

Create `packages/prerender/src/build-and-import/viteSsrBuildAndImport.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { build, mergeConfig } from 'vite'
import type { InlineConfig } from 'vite'

import { getPaths } from '@cedarjs/project-config'
import { getWebSideViteConfig } from '@cedarjs/vite'

/**
 * Replaces buildAndImport (Rollup + SWC).
 *
 * Builds the given entry file as an SSR bundle using Cedar's existing web Vite
 * config (all Cedar plugins already configured there), imports the result, then
 * cleans up.
 */
export async function viteSsrBuildAndImport(
  entryPath: string
): Promise<unknown> {
  const outDir = path.join(getPaths().web.dist, '__prerender_ssr')

  const webConfig = await getWebSideViteConfig()

  const ssrConfig: InlineConfig = {
    logLevel: 'warn',
    build: {
      ssr: entryPath,
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        output: { format: 'esm' },
      },
    },
  }

  await build(mergeConfig(webConfig, ssrConfig))

  const outFile = path.join(
    outDir,
    path.basename(entryPath).replace(/\.tsx?$/, '.js')
  )

  const module = await import(pathToFileURL(outFile).href)
  await fs.rm(outDir, { recursive: true, force: true })

  return module
}
```

### Phase 2 — Update `runPrerenderEsm.tsx`

Replace the `buildAndImport` call:

```ts
// Before:
const required = await buildAndImport({ filepath: entryPath })

// After:
const required = await viteSsrBuildAndImport(entryPath)
```

The combined entry file (the temp `.tsx` that re-exports `App`, `Routes`, etc.)
can be kept as-is — Vite builds it the same way Rollup did.

### Phase 3 — Handle SSR-specific asset edge cases

Vite's SSR build handles most asset types natively, but two cases need
verification:

**CSS/HTML imports:** In SSR mode Vite already stubs CSS imports. If any edge
cases remain, add a thin plugin scoped strictly to stylesheet extensions — do
**not** include image extensions in this plugin, as those should be converted to
public URL strings by Vite's asset pipeline:

```ts
// Only stub actual stylesheet imports — NOT images
export function cedarPrerenderIgnoreStylesPlugin(): Plugin {
  return {
    name: 'cedar-prerender-ignore-styles',
    load(id) {
      if (/\.(css|scss|sass|less)(\?.*)?$/.test(id)) {
        return 'export default {}'
      }
    },
  }
}
```

**Dev fatal error page:** Port `rollup-plugin-cedar-remove-dev-fatal-error-page`
to a simple Vite transform plugin. This is a trivial rename.

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

---

## Why `vite build --ssr` Over `RunnableDevEnvironment`

An earlier version of this plan proposed a `WebNodeRunner` using Vite's
`RunnableDevEnvironment` (the same API `NodeRunner` uses for the API side).
`vite build --ssr` is preferred because:

|                                  | `vite build --ssr`        | `RunnableDevEnvironment` |
| -------------------------------- | ------------------------- | ------------------------ |
| Uses existing web config         | ✅ automatic              | ❌ manual plugin wiring  |
| Disk artifact                    | ✅ inspectable, auditable | ❌ in-memory only        |
| What other frameworks do         | ✅ SvelteKit, Nuxt        | ❌ mostly dev-mode usage |
| Dev server running at build time | ✅ no                     | ❌ yes (feels wrong)     |
| Future SSR alignment             | ✅ same artifact reused   | ❌ different path        |

The `RunnableDevEnvironment` approach required manually listing all Cedar
plugins and keeping that list in sync with Cedar's web Vite config.
`vite build --ssr` just passes the existing config — if a new plugin is added to
Cedar's web build, prerender picks it up automatically.

---

## Open Questions

1. **Routes auto-loader prerender variant.** `cedarjsRoutesAutoLoaderPlugin` has
   two modes: the normal client build mode (lazy `import()` per route, populates
   `globalThis.__REDWOOD__PRERENDER_PAGES`) and a prerender mode (direct
   `import` per route). The SSR build must use the prerender variant to avoid
   depending on a global that may not be populated at build time. Verify how the
   plugin decides which mode to use and ensure the SSR build path triggers the
   correct one.

2. **`cedarAutoImportsPlugin` and `gql` bindings.** Cells use Cedar's implicit
   `gql` binding injected by `cedarAutoImportsPlugin`. This plugin is already in
   Cedar's web Vite config, so it runs automatically with `vite build --ssr`.
   Verify that the SSR build path doesn't skip it (some plugins guard on
   `build.ssr` being falsy).

3. **`renderCache` invalidation.** `runPrerenderEsm.tsx` caches `App` and
   `Routes` between page renders. With `viteSsrBuildAndImport`, the build runs
   once and produces a single bundle — the same caching strategy applies, but
   verify the import is stable across render cycles.

4. **`ssr.noExternal` / workspace packages.** Rollup's `externalPlugin` has
   nuanced logic for keeping certain `@cedarjs/*` workspace packages internal to
   the bundle. Vite's `ssr.noExternal` should handle this, but needs testing
   against packages that ship only CJS.

5. **`getWebSideViteConfig` API.** The implementation above assumes a function
   that returns Cedar's resolved web Vite config programmatically. Verify what
   the correct internal API is (may be `loadViteConfigFromFile` or similar).

---

## Relationship to Future SSR

When Cedar eventually adds request-time SSR, it will use the same
`vite build --ssr` mechanism — but instead of executing the bundle once and
discarding it, the bundle gets deployed and executes on every request:

```
SSG (today, after migration):
  vite build --ssr → bundle → execute at build time → .html files → done

SSR (future):
  vite build --ssr → bundle → deploy → execute per request → stream HTML to client
```

Migrating prerender to `vite build --ssr` now means SSR support can be added
without revisiting the prerender build pipeline. The same artifact serves both
purposes.

---

## Files Affected

**New files:**

- `packages/prerender/src/build-and-import/viteSsrBuildAndImport.ts`
- `packages/prerender/src/build-and-import/vitePlugins/vite-plugin-prerender-ignore-styles.ts`
  (if needed)
- `packages/prerender/src/build-and-import/vitePlugins/vite-plugin-prerender-remove-dev-fatal-error-page.ts`

**Modified:**

- `packages/prerender/src/runPrerenderEsm.tsx` — swap `buildAndImport` for
  `viteSsrBuildAndImport`
- `packages/prerender/package.json` — remove Rollup/SWC deps

**Deleted:**

- `packages/prerender/src/build-and-import/buildAndImport.ts`
- `packages/prerender/src/build-and-import/rollupPlugins/` (entire directory)

**Eventually:**

- `packages/prerender/src/runPrerender.tsx` — the legacy Babel/CJS path; can be
  deleted once the ESM path is confirmed stable

---

## What This Does NOT Cover

- Replacing SWC in the RSC Vite plugins (`vite-plugin-rsc-transform-server.ts`,
  `vite-plugin-rsc-analyze.ts`) — separate effort.
- The legacy `runPrerender.tsx` (Babel path) — out of scope here, but this
  migration makes it easier to reason about deleting it.
- Request-time SSR — documented above as future work that this migration
  directly enables.
