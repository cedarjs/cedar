# Plan: Single Vite Build for Universal Deploy

**Date**: 2026-06-21 **Status**: Draft for implementation

## What we have today

Two sequential Vite builds for cedar build --ud:

```
buildCedarApp()           buildUDApiServer()
┌──────────────────┐      ┌──────────────────────┐
│ builder.build()  │      │ vite.build({         │
│ - client (web)   │ then │ ssr: true,           │
│ - api (dist/)    │      │ input: catchAll,     │
└──────────────────┘      │ outDir: api/ud,      │
                          │ })                   │
                          └──────────────────────┘
```

The user's web/vite.config.ts is loaded twice (once per build), causing:

- clearCedarEntries() hack — accesses Symbol.for('ud:store') internals to clear
  stale entries left by the first pass
- Provider output dir save/restore — buildUDApiServer manually saves/restores
  .vercel/output because the second config load re-fires provider buildStart
  cleanup hooks that would delete artifacts from the first pass
- Slower builds — parsing the config, resolving plugins, and running Rollup
  twice

## Target state

A single buildCedarApp() with three declared environments:

```
buildCedarApp({ ud: true })
┌──────────────────────────────┐
│ builder.build()              │
│ - client → web/dist/         │
│ - api → api/dist/            │
│ - ud-server →  api/dist/ud/  │ ← NEW
└──────────────────────────────┘
```

The user's config is loaded once. catchAll() generates the rou3 router during
the ud-server environment's build. No stale entries, no provider dir
save/restore, one Vite pass.

## Summary

Merge `buildCedarApp()` and `buildUDApiServer()` into a single Vite builder
pass. After this change, `cedar build --ud` runs one
`buildCedarApp({ ud: true })` call that produces all three outputs: `web/dist/`,
`api/dist/`, and `api/dist/ud/`.

The user's `web/vite.config.ts` is loaded **once** instead of twice, eliminating
the `clearCedarEntries()` hack, the provider output directory save/restore
dance, and one full Vite parse+resolve cycle.

## Motivation

Today `cedar build --ud` runs two sequential Vite builds:

1. `buildCedarApp()` — Vite Environment API, builds `client` + `api`
   environments
2. `buildUDApiServer()` — legacy `vite.build({ ssr: true })`, builds UD server
   entry at `api/dist/ud/index.js`

Both load the same `web/vite.config.ts`. This creates several problems:

- **Stale UD store entries**: The `cedarUniversalDeployPlugin` runs during both
  builds, registering entries in the global UD store. Entries from the first
  pass (client build) are stale for the second pass (API server build). Fixed
  today with `clearCedarEntries()` which accesses `Symbol.for('ud:store')`
  internals.
- **Provider output dir clobbering**: Provider plugins (Vercel, Netlify) clean
  their output directories during `buildStart`. The second build re-fires those
  cleanup hooks, deleting artifacts from the first pass. Fixed today by saving
  and restoring `.vercel/output` and similar directories.
- **Slower builds**: Loading the user's config, resolving plugins, and running
  Rollup twice for essentially the same compilation context.
- **API divergence**: `buildCedarApp()` uses the modern Environment API while
  `buildUDApiServer()` uses the legacy `ssr: true` top-level flag. A single
  environment-declaration path is cleaner.

## Target state

`cedar build --ud` runs a single `buildCedarApp({ ud: true })` that declares
three environments:

```text
buildCedarApp({ ud: true })
  builder.build(client)     → web/dist/
  builder.build(api)        → api/dist/
  builder.build(ud-server)  → api/dist/ud/index.js
```

The `ud-server` environment is a Vite SSR build with `input: catchAllEntry` —
the same semantics as the current `buildUDApiServer`, but expressed as a
declared environment instead of a separate `vite.build()` call.

Everything that `buildUDApiServer` does today (per-function chunk emission,
catchAll router generation, esbuild bundling of handler modules) still happens,
but driven from the `cedarUniversalDeployPlugin` and `catchAll()` plugin during
the `ud-server` environment's build lifecycle.

## Non-goals

- Changing the output shape or location of any artifact.
- Changing `cedar dev --ud` behavior.
- Changing `cedar serve --ud` or `cedar serve api --ud` behavior.
- Reworking the `cedarUniversalDeployPlugin`'s route discovery or virtual module
  generation logic.
- Upgrading Vite or changing version constraints.

## Detailed design

### How the environment API approach replaces the legacy build

Today `buildUDApiServer()` calls `vite.build()` with the legacy top-level
`build.ssr: true` flag. In Vite 7+, that flag instructs Vite to create a default
`ssr` environment. The `cedarUniversalDeployPlugin` gates its `buildStart`,
`resolveId`, and `load` hooks on `this.environment.name === 'ssr'` to run only
during this server build.

In the new model, we declare a named `ud-server` environment in
`buildCedarApp()`'s environment map. The `cedarUniversalDeployPlugin` gates on
`this.environment.name === 'ud-server'` instead. The `catchAll()` plugin from
`@universal-deploy/vite` is added to the builder's plugin list and activates
when the `ud-server` environment's Rollup build resolves its
`virtual:ud:catch-all` entry.

### Plugin lifecycle in the unified build

```
createBuilder({ configFile, plugins, environments })
  ↓
config (user plugins run, including cedarUniversalDeployPlugin and vercel())
  → cedarUniversalDeployPlugin registers routes in UD store (once)
  → vercel() declares vercel_client/vercel_edge/vercel_node environments
  → cedarUniversalDeployPlugin removes stale entries: REMOVED (no-op)
  ↓
builder.buildApp()
  → cedar-build-app hook (order: pre)
    → builder.build(client)   → builds web SPA
    → builder.build(api)      → builds API functions with Babel
    → builder.build(ud-server) → builds UD Fetchable
  → vercel buildApp hook (order: post)
    → builder.build(vercel_client) → copies static assets
    → builder.build(vercel_edge)   → builds edge functions
    → builder.build(vercel_node)   → builds node functions
  ↓
Done. All artifacts produced, no double-cleanup.
```

### Key components and how they change

#### `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`

| Concern                 | Current                           | New                                     |
| ----------------------- | --------------------------------- | --------------------------------------- |
| `buildStart` gate       | `this.environment.name !== 'ssr'` | `this.environment.name !== 'ud-server'` |
| `resolveId`/`load` gate | Skip `client` and `api`           | Accept only `ud-server`                 |
| `clearCedarEntries()`   | Called in `config` hook           | Removed entirely                        |
| `UD_STORE_SYMBOL`       | Used by `clearCedarEntries`       | Removed entirely                        |

The `config` hook runs once (Vite resolves the config once) and registers all
routes in the UD store. The `buildStart` hook emits per-function handler chunks
during the `ud-server` environment's build. The `resolveId`/`load` hooks serve
virtual modules only to the `ud-server` environment.

No other behavior changes — route discovery, entry registration, esbuild
bundling, and virtual module generation are identical.

#### `packages/vite/src/buildApp.ts`

Add a `ud?: boolean` option to `BuildCedarAppOptions`. When `ud` is true and
`workspace` includes `api`, declare a `ud-server` environment:

```ts
if (ud && workspace.includes('api')) {
  environments['ud-server'] = {
    build: {
      ssr: true,
      outDir: path.join(cedarPaths.api.dist, 'ud'),
      emptyOutDir: true,
      rollupOptions: {
        input: catchAllEntry,
        output: {
          entryFileNames: 'index.js',
        },
        external: (id: string) => {
          if (id.startsWith('node:')) {
            return true
          }
          if (!id.startsWith('.') && !path.isAbsolute(id)) {
            return true
          }
          return false
        },
      },
    },
  }
}
```

Conditionally add `catchAll()` and a verify-routes plugin to the plugins array:

```ts
if (ud) {
  plugins.push(catchAll())
  plugins.push({
    name: 'cedar-ud-verify-routes',
    configResolved() {
      const entries = getAllEntries()
      if (entries.length === 0) {
        console.warn(/* ... */)
      }
    },
  })
}
```

Update the `cedar-build-app` plugin handler to build the `ud-server`
environment:

```ts
if (
  workspace.includes('api') &&
  builder.environments['ud-server'] &&
  !builder.environments['ud-server'].isBuilt
) {
  await builder.build(builder.environments['ud-server'])
}
```

Also move the `package.json` `{ type: 'module' }` write — currently done by
`buildUDApiServer` after its build completes. Add a `closeBundle` or
`writeBundle` plugin that writes this file to the `ud-server` output directory:

```ts
if (ud) {
  plugins.push({
    name: 'cedar-ud-write-package-json',
    applyToEnvironment(env) {
      return env.name === 'ud-server'
    },
    closeBundle() {
      fs.writeFileSync(
        path.join(cedarPaths.api.dist, 'ud', 'package.json'),
        JSON.stringify({ type: 'module' }, null, 2)
      )
    },
  })
}
```

(The `applyToEnvironment` filter ensures this only runs for `ud-server`, not for
`client` or `api`.)

#### `packages/cli/src/commands/build/buildHandler.ts`

- Remove the `import { buildUDApiServer }` at line 28.
- Remove the second Listr task (lines 398-404, the "Bundling API server entry"
  task).
- Pass `ud: true` to `buildCedarApp` in the unified build task (line 380):

```ts
await buildCedarApp({ verbose, workspace, ud: true })
```

The `--apiRootPath` env var mechanism (lines 411-432 in buildHandler.ts)
continues to work unchanged — `process.env.CEDAR_API_ROOT_PATH` is set before
the build and read by `cedarUniversalDeployPlugin` in its constructor.

#### `packages/vite/src/buildUDApiServer.ts` — deleted

The entire file is no longer called by anything. Delete it and remove its export
from `packages/vite/package.json`.

#### `packages/vite/package.json`

Remove the `./buildUDApiServer` export entry.

### Interaction with provider plugins (Vercel, Netlify)

**Verified compatible.** The analysis of `vite-plugin-vercel` v11.1.1 shows:

- Provider plugins add their own named environments (e.g., `vercel_edge`,
  `vercel_node`). These do not collide with `ud-server`.
- Provider `buildApp` hooks use `order: 'post'`; Cedar's uses `order: 'pre'`.
  Cedar's environments build first, then the provider's environments build.
- Provider cleanup plugins use `sharedDuringBuild: true` with `sequential: true`
  and an `alreadyRun` guard — they clean once on the first `buildStart` and skip
  subsequent environments.
- The provider output dir save/restore dance (`.vercel/output` backup) in the
  current `buildUDApiServer.ts` existed precisely because the second
  `vite.build()` call re-fired all provider hooks. With a single builder pass,
  provider hooks fire once — no save/restore needed.
- `catchAll()` is already included in `vercel()`'s plugin array. Having a second
  instance via Cedar's plugins array is harmless (identical virtual module
  resolution).

### What about `vite-plugin-vercel`'s `buildStart` cleanup?

The current save/restore dance in `buildUDApiServer.ts` (lines 54-63, 131-139)
saves `.vercel/output` before `build()` and restores it after because Vercel's
`buildStart` cleanup removes it. In the unified model:

- `buildStart` fires once (per environment, but `sharedDuringBuild: true` means
  the `alreadyRun` guard skips subsequent calls).
- Provider cleanup runs on the first `buildStart` (before any environment's
  Rollup build actually starts).
- The `ud-server` environment builds normally — no second cleanup event.

The save/restore code is removed along with `buildUDApiServer.ts`.

## Files affected

| File                                                              | Change                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/vite/src/buildApp.ts`                                   | Add `ud` option, `ud-server` environment, `catchAll()` plugin, verify-routes plugin, package.json writer |
| `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts` | Remove `clearCedarEntries()`, change environment gates from `ssr` to `ud-server`                         |
| `packages/cli/src/commands/build/buildHandler.ts`                 | Remove `buildUDApiServer` task and import, pass `ud: true` to `buildCedarApp`                            |
| `packages/vite/src/buildUDApiServer.ts`                           | Delete                                                                                                   |
| `packages/vite/package.json`                                      | Remove `./buildUDApiServer` export                                                                       |
| `packages/vite/src/index.ts`                                      | Remove `buildUDApiServer` re-export (if present)                                                         |
| `packages/cli/src/commands/build/__tests__/build.test.ts`         | Update task titles and expected behavior                                                                 |
| `tasks/ud-tests/udDev.test.mts`                                   | Verify single-pass build still works                                                                     |
| `tasks/ud-tests/udServe.test.mts`                                 | Verify serve still works against unified build output                                                    |

## Implementation sequence

### Step 1: Prepare `cedarUniversalDeployPlugin` for single-pass

Edit `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`:

- [ ] Delete `UD_STORE_SYMBOL` constant (line 25)
- [ ] Delete `clearCedarEntries()` function (lines 141-162)
- [ ] Remove `clearCedarEntries()` call in `config` handler (line 191)
- [ ] Change `buildStart` gate from `this.environment.name !== 'ssr'` to
      `this.environment.name !== 'ud-server'` (line 212)
- [ ] Change `resolveId` gate: replace
      `viteEnv.config.consumer === 'client' || viteEnv.name === 'api'` with
      `viteEnv.name !== 'ud-server'` (line 241)
- [ ] Change `load` gate: same replacement (line 262)

### Step 2: Add `ud-server` environment to `buildCedarApp`

Edit `packages/vite/src/buildApp.ts`:

- [ ] Import `catchAllEntry` from `@universal-deploy/store`
- [ ] Import `catchAll` from `@universal-deploy/vite`
- [ ] Import `getAllEntries` from `@universal-deploy/store`
- [ ] Add `ud?: boolean` to `BuildCedarAppOptions`
- [ ] Add `ud-server` environment declaration (conditional on
      `ud && workspace.includes('api')`)
- [ ] Add `catchAll()` to plugins array (conditional on `ud`)
- [ ] Add verify-routes plugin (conditional on `ud`)
- [ ] Add package.json writer plugin (conditional on `ud`)
- [ ] Add `ud-server` build call to `cedar-build-app` handler

### Step 3: Wire up the CLI build handler

Edit `packages/cli/src/commands/build/buildHandler.ts`:

- [ ] Remove `import { buildUDApiServer } from '@cedarjs/vite/buildUDApiServer'`
      (line 28)
- [ ] Remove the second Listr task (lines 398-404)
- [ ] Pass `ud: true` to `buildCedarApp` (line 380)

### Step 4: Clean up `buildUDApiServer`

- [ ] Delete `packages/vite/src/buildUDApiServer.ts`
- [ ] Remove `./buildUDApiServer` export from `packages/vite/package.json`
- [ ] Remove any `buildUDApiServer` re-export from `packages/vite/src/index.ts`

### Step 5: Update tests

- [ ] `packages/cli/src/commands/build/__tests__/build.test.ts` — update task
      titles, verify single build task for UD path
- [ ] `tasks/ud-tests/udDev.test.mts` — run full test suite, confirm passing
- [ ] `tasks/ud-tests/udServe.test.mts` — run full test suite, confirm passing
- [ ] Manual test: `cedar build --ud` in local-testing-project, inspect output
- [ ] Manual test: `cedar serve api --ud` serves GraphQL successfully
- [ ] Manual test: `cedar serve --ud` serves both sides with proxy

### Step 6: Verify provider plugin compatibility

- [ ] `cedar build --ud` with `vite-plugin-vercel` in user config — verify
      `.vercel/output/config.json` and `api/dist/ud/index.js` both exist
- [ ] `cedar build --ud` with `vercel()` plugin — verify no save/restore
      warnings or errors
- [ ] `cedar build --ud` with no provider plugins — verify the UD Fetchable is
      produced and functional

## Verification

Run these commands after each step:

```bash
yarn workspace @cedarjs/vite build
yarn workspace @cedarjs/cli build
yarn workspace @cedarjs/vite test
yarn workspace @cedarjs/cli test -- --testPathPattern='build|dev'
```

And the UD integration tests:

```bash
yarn test -- --config tasks/ud-tests/vitest.config.mts
```

## Future work (not in scope)

- **Unified dev server**: The dev path (`cedar dev --ud`) already uses a single
  Vite dev server (`cedar-unified-dev.ts`). This plan doesn't change it.
- **Single-port serve**: The serve path (`cedar serve --ud`) remains two-port
  with srvx on both ports. A future change could add single-port mode.
- **Phase 6: Route registration formalization**: Per-route UD entry registration
  is deferred to a separate plan.
