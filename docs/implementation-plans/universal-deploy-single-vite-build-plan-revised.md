# Plan: Single Vite Build for Universal Deploy (Revised)

**Date**: 2026-06-21 **Status**: Revised draft for implementation
**Supersedes**: `universal-deploy-single-vite-build-plan.md` (initial draft)
**Revision summary**: Tightens the cedarUniversalDeployPlugin gate strategy to
preserve provider-plugin environment compatibility, adds a fixture-based
integration test and a unit test for the plugin gates, switches `catchAll()`
injection to a detect-and-inject pattern, removes now-redundant code, and
addresses review feedback.

## What we have today

Two sequential Vite builds for `cedar build --ud`:

```
buildCedarApp()              buildUDApiServer()
┌──────────────────┐         ┌──────────────────────┐
│  builder.build() │         │  vite.build({        │
│  - client (web)  │  then   │    ssr: true,        │
│  - api (dist/)   │         │    input: catchAll   │
└──────────────────┘         │    outDir: api/ud    │
                             │  })                  │
                             └──────────────────────┘
```

The user's `web/vite.config.ts` is loaded twice (once per build), causing:

- `clearCedarEntries()` hack — accesses `Symbol.for('ud:store')` internals to
  clear stale entries left by the first pass.
- Provider output dir save/restore — `buildUDApiServer` manually saves and
  restores `.vercel/output` because the second config load re-fires provider
  `buildStart` cleanup hooks that would delete artifacts from the first pass.
- Slower builds — parsing the config, resolving plugins, and running Rollup
  twice.

## Target state

A single `buildCedarApp()` with three declared environments:

```
buildCedarApp({ ud: true })
┌────────────────────────────────────┐
│  builder.build()                   │
│  - client        → web/dist/       │
│  - api           → api/dist/       │
│  - ud-server     → api/dist/ud/    │  ← NEW
└────────────────────────────────────┘
```

The user's config is loaded once. `catchAll()` generates the rou3 router during
the `ud-server` environment's build. No stale entries, no provider dir
save/restore, one config load, one builder orchestration. The output location
(`api/dist/ud/index.js`, `api/dist/ud/package.json`, `api/dist/ud/chunks/*`) is
unchanged, so `cedar serve`, `cedar serve api --ud`, and the deployed artifacts
on Vercel/Netlify are unaffected.

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
   environments.
2. `buildUDApiServer()` — legacy `vite.build({ ssr: true })`, builds UD server
   entry at `api/dist/ud/index.js`.

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

## Non-goals

- Changing the output shape or location of any artifact under `web/dist/`,
  `api/dist/`, or `api/dist/ud/`. `cedar serve`, `cedar serve api --ud`, and the
  deployed artifacts are unaffected.
- Changing `cedar dev --ud` behavior. The `cedarUniversalDeployPlugin` is
  `apply: 'build'`; dev mode does not use it.
- Changing `cedar serve --ud` or `cedar serve api --ud` behavior.
- Reworking the `cedarUniversalDeployPlugin`'s route discovery or virtual module
  generation logic. The plugin's semantics are preserved.
- Upgrading Vite or changing version constraints.
- Cloudflare Workers support. The plan only considers Vercel and Netlify as
  provider plugins. Cloudflare is deferred to a future plan.
- Adding per-route UD entry registration (deferred to a separate plan).

## Detailed design

### How the environment API approach replaces the legacy build

Today `buildUDApiServer()` calls `vite.build()` with the legacy top-level
`build.ssr: true` flag. In Vite 7+, that flag instructs Vite to create a default
`ssr` environment. The `cedarUniversalDeployPlugin` gates its `buildStart`,
`resolveId`, and `load` hooks on `this.environment.name === 'ssr'` to run only
during this server build.

In the new model, we declare a named `ud-server` environment in
`buildCedarApp()`'s environment map. The `cedarUniversalDeployPlugin` gates
`buildStart` on `this.environment.name === 'ud-server'`, but its `resolveId` and
`load` hooks remain permissive (skip `client` and `api`, accept all other server
environments). The `catchAll()` plugin from `@universal-deploy/vite` is added to
the builder's plugin list and activates when the `ud-server` environment's
Rollup build resolves its `virtual:ud:catch-all` entry.

The gate asymmetry is intentional and required for provider-plugin
compatibility. The `buildStart` gate only fires chunk emission for `ud-server`
(so the catchAll's dynamic imports resolve to chunks in `api/dist/ud/chunks/`).
The `resolveId` and `load` gates must still accept provider environments
(`vercel_edge`, `vercel_node`, Netlify equivalents) so the per-function virtual
modules can be resolved and inlined into the provider's per-function bundles.
The cedar plugin's `load` hook returns self-contained code (the function bundled
inline via esbuild), so provider environments do not need the cedar-emitted
chunks; they only need the resolveId/load hooks to fire.

### Plugin lifecycle in the unified build

```
createBuilder({ configFile, plugins, environments })
  ↓
config (user plugins run, including cedarUniversalDeployPlugin and vercel())
  → cedarUniversalDeployPlugin registers routes in UD store (once)
  → vercel() declares vercel_client/vercel_edge/vercel_node environments
  → cedar-ud-inject-catchall config hook adds catchAll() if not already present
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
Done. All artifacts produced, no double-cleanup, no provider output
save/restore.
```

### Key components and how they change

#### `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`

| Concern                 | Current                           | New                                              |
| ----------------------- | --------------------------------- | ------------------------------------------------ |
| `buildStart` gate       | `this.environment.name !== 'ssr'` | `this.environment.name !== 'ud-server'`          |
| `resolveId`/`load` gate | Skip `client` and `api`           | Skip `client` and `api` (unchanged — permissive) |
| `clearCedarEntries()`   | Called in `config` hook           | Removed entirely                                 |
| `UD_STORE_SYMBOL`       | Used by `clearCedarEntries`       | Removed entirely                                 |
| `entriesInjected` flag  | Guards `addEntry` re-entry        | Removed (`addEntry` already dedupes)             |

The `config` hook runs once (Vite resolves the config once for the single
builder pass) and registers all routes in the UD store. The `buildStart` hook
emits per-function handler chunks during the `ud-server` environment's build
only. The `resolveId`/`load` hooks serve virtual modules to any non-client
non-api environment — including `ud-server` and any provider environment
(`vercel_edge`, `vercel_node`, Netlify equivalents) — so per-function bundles
are produced for each provider's per-function target.

The `entriesInjected` flag is removed because `@universal-deploy/store`'s
`addEntry` (node_modules/@universal-deploy/store/dist/index.js:15-20)
deduplicates entries by JSON serialization. The flag is defense-in-depth at best
and dead code in the single-pass model.

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

Inject `catchAll()` and supporting plugins only when `ud` is true. Use a
detect-and-inject pattern via a `config` hook so we don't add a duplicate
`catchAll()` when the user's config already includes one (e.g. via
`vercel()`/`netlify()`):

```ts
if (ud) {
  plugins.push({
    name: 'cedar-ud-inject-catchall',
    config(config) {
      const alreadyHasCatchAll = (config.plugins ?? []).some((p) =>
        isPluginWithName(p, 'ud:catch-all')
      )
      if (alreadyHasCatchAll) {
        return
      }
      return {
        plugins: [catchAll()],
      }
    },
  })

  // Warn if no Cedar API routes were registered — likely means the user's
  // vite config is missing cedarUniversalDeployPlugin or there are no API
  // functions to serve.
  plugins.push({
    name: 'cedar-ud-verify-routes',
    configResolved() {
      const entries = getAllEntries()
      if (entries.length === 0) {
        console.warn(/* same warning as buildUDApiServer.ts */)
      }
    },
  })

  // Write a package.json marking the UD output as ESM. closeBundle is a
  // Rollup hook that fires once per environment after all chunks are
  // written; applyToEnvironment restricts it to the ud-server env.
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

The `isPluginWithName` helper unwraps Vite's `PluginOption` shape
(`Plugin[] | Promise<...> | undefined | false | null | ...`) safely. The
simplest implementation is:

```ts
function isPluginWithName(p: unknown, name: string): boolean {
  if (p == null || typeof p !== 'object') {
    return false
  }
  // PluginOption can be a Plugin array, a Plugin object, or a Promise that
  // resolves to either. We only need to handle the synchronous Plugin case
  // here because config.plugins is the synchronous, post-resolution list.
  if (Array.isArray(p)) {
    return p.some((sub) => isPluginWithName(sub, name))
  }
  return (p as { name?: string }).name === name
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

The existing default-`ssr` environment deletion in `cedar-build-app-cleanup`
(buildApp.ts:198-200) still applies: when `ud: true` and no user-declared `ssr`
environment exists, Vite's default `ssr` env is removed. The `ud-server` env is
declared explicitly so it survives this cleanup.

**`devServer()` is intentionally not included** in the new plugins array. The
current `buildUDApiServer.ts:83` adds `devServer()` from
`@universal-deploy/vite`, but that plugin is gated on
`command === "serve" && mode !== "test"`
(node_modules/@universal-deploy/vite/dist/index.js:269-271) so it is a no-op
during build. The unified builder is build-only, so `devServer()` is omitted.

#### `packages/cli/src/commands/build/buildHandler.ts`

- Remove the `import { buildUDApiServer }` (line 28).
- Remove the second Listr task (lines 398-404, the "Bundling API server entry"
  task).
- Pass `ud: true` to `buildCedarApp` in the unified build task (line 380):

```ts
await buildCedarApp({ verbose, workspace, ud: true })
```

The `--apiRootPath` env var mechanism at buildHandler.ts:411-413 continues to
work unchanged. `process.env.CEDAR_API_ROOT_PATH` is set after the tasks array
is constructed but before `jobs.run()` (line 422), so the value is available to
`cedarUniversalDeployPlugin`'s constructor when `buildCedarApp` runs.

#### `packages/vite/src/buildUDApiServer.ts` — deleted

The entire file is no longer called by anything. Delete it and remove its export
from `packages/vite/package.json`.

#### `packages/vite/package.json`

Remove the `./buildUDApiServer` export entry.

#### `packages/vite/src/index.ts`

No change required. `index.ts` does not re-export `buildUDApiServer` (verified —
it exports `buildCedarApp` from `build/build.ts` instead).

### Interaction with provider plugins (Vercel, Netlify)

Provider plugins (verified against `vite-plugin-vercel`, `@netlify/vite-plugin`,
in the e2e CI workflows `.github/workflows/e2e-vercel.yml` and
`.github/workflows/e2e-netlify.yml`):

- Provider plugins add their own named environments (e.g., `vercel_edge`,
  `vercel_node`). These do not collide with `ud-server`.
- Provider `buildApp` hooks use `order: 'post'`; Cedar's uses `order: 'pre'`.
  Cedar's environments build first, then the provider's environments build.
- Provider cleanup plugins use `sharedDuringBuild: true` with `sequential: true`
  and an `alreadyRun` guard — they clean once on the first `buildStart` and skip
  subsequent environments.
- The provider output dir save/restore dance (`.vercel/output` backup) in the
  current `buildUDApiServer.ts:54-63, 130-139` existed precisely because the
  second `vite.build()` call re-fired all provider hooks. With a single builder
  pass, provider hooks fire once — no save/restore needed.
- The cedar plugin's per-function `load` hook returns self-contained code (the
  function bundled inline via esbuild), so provider environments build
  per-function bundles without depending on the cedar-emitted chunks in
  `api/dist/ud/chunks/`. The chunks are only used by the `ud-server`
  environment's `catchAll` dynamic imports.

### What about `vite-plugin-vercel`'s `buildStart` cleanup?

The current save/restore dance in `buildUDApiServer.ts:54-63, 130-139` saves
`.vercel/output` before `build()` and restores it after because Vercel's
`buildStart` cleanup removes it. In the unified model:

- `buildStart` fires once (per environment, but `sharedDuringBuild: true` means
  the `alreadyRun` guard skips subsequent calls).
- Provider cleanup runs on the first `buildStart` (before any environment's
  Rollup build actually starts).
- The `ud-server` environment builds normally — no second cleanup event.

The save/restore code is removed along with `buildUDApiServer.ts`.

### `catchAll()` injection: detect-and-inject

When the user's config already includes a provider plugin (`vercel()`,
`netlify()`, etc.), the provider's plugin array typically includes `catchAll()`
from `@universal-deploy/vite`. Both copies have the same plugin name
(`"ud:catch-all"`) and the same `resolveId`/`load` filter. The `resolveId` hooks
are pass-through returns and dedupe correctly; the `load` hooks would both run
and return identical code (same store, same logic), but Vite would warn about
the duplicate plugin name.

The detect-and-inject pattern in `cedar-ud-inject-catchall` checks
`config.plugins` in a `config` hook and only injects `catchAll()` when no plugin
named `ud:catch-all` is already present. This avoids the duplicate warning
without coupling to provider-plugin internals.

## Files affected

| File                                                                             | Change                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`                | Remove `clearCedarEntries`, `UD_STORE_SYMBOL`, `entriesInjected`; change `buildStart` gate to `ud-server`                                                              |
| `packages/vite/src/buildApp.ts`                                                  | Add `ud` option, `ud-server` environment, detect-and-inject `catchAll`, verify-routes plugin, package.json writer                                                      |
| `packages/cli/src/commands/build/buildHandler.ts`                                | Remove `buildUDApiServer` task and import, pass `ud: true` to `buildCedarApp`                                                                                          |
| `packages/vite/src/buildUDApiServer.ts`                                          | Delete                                                                                                                                                                 |
| `packages/vite/package.json`                                                     | Remove `./buildUDApiServer` export                                                                                                                                     |
| `packages/vite/src/plugins/__tests__/vite-plugin-cedar-universal-deploy.test.ts` | NEW: unit test for the cedar plugin's gate behavior                                                                                                                    |
| `tasks/test-project/generate-fixture-ud-netlify.mts`                             | NEW: script that copies `test-project-esm` and applies the UD Netlify delta. Run `node tasks/test-project/generate-fixture-ud-netlify.mts` after base fixture rebuilds |
| `packages/vite/src/buildApp.test.ts`                                             | NEW: structural assertion test for `buildCedarApp({ ud: true })` output tree                                                                                           |
| `packages/cli/src/commands/build/__tests__/build.test.ts`                        | Update task titles and expected behavior                                                                                                                               |
| `tasks/ud-tests/udDev.test.mts`                                                  | Verify single-pass build still works                                                                                                                                   |
| `tasks/ud-tests/udServe.test.mts`                                                | Verify serve still works against unified build output                                                                                                                  |
| `tasks/netlify-tests/local-test.mts`                                             | Add as required verification step (already exercises the build+provider-plugin path)                                                                                   |
| `tasks/vercel-tests/local-test.mts`                                              | Add as required verification step (already exercises the build+provider-plugin path)                                                                                   |

## Implementation sequence

### Step 1: Prepare `cedarUniversalDeployPlugin` for single-pass

Edit `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`:

- [ ] Delete the `UD_STORE_SYMBOL` constant.
- [ ] Delete the `clearCedarEntries()` function and its JSDoc.
- [ ] Remove the `clearCedarEntries()` call in the `config` handler.
- [ ] Remove the `entriesInjected` flag and the `if (entriesInjected) return`
      guard.
- [ ] Change the `buildStart` gate from `this.environment.name !== 'ssr'` to
      `this.environment.name !== 'ud-server'`.
- [ ] Leave the `resolveId` and `load` gates as-is (skip `client` and `api`). Do
      **not** tighten to `ud-server`-only — provider environments
      (`vercel_edge`, `vercel_node`, Netlify equivalents) need these hooks to
      resolve and bundle per-function virtual modules.

### Step 2: Add a unit test for `cedarUniversalDeployPlugin`

Create
`packages/vite/src/plugins/__tests__/vite-plugin-cedar-universal-deploy.test.ts`:

- [ ] Construct the plugin and exercise the `config` hook — assert
      `getAllEntries()` contains the expected number of entries after
      invocation.
- [ ] Construct the plugin with a fake
      `this.environment = { name: 'ud-server' }` and exercise `buildStart` —
      assert chunks are emitted.
- [ ] Construct the plugin with a fake `this.environment = { name: 'client' }`
      and exercise `buildStart` — assert no chunks are emitted.
- [ ] Construct the plugin with a fake
      `this.environment = { name: 'vercel_node' }` and exercise `resolveId` for
      `virtual:cedar-api:fn:graphql` — assert the hook returns a non-null id
      (this codifies the "permissive gate" invariant).
- [ ] Construct the plugin with a fake `this.environment = { name: 'client' }`
      and exercise `resolveId` for `virtual:cedar-api:fn:graphql` — assert the
      hook returns `undefined`.
- [ ] Construct the plugin with a fake `this.environment = { name: 'api' }` and
      exercise `resolveId` for `virtual:cedar-api:fn:graphql` — assert the hook
      returns `undefined`.

This is the first unit test for the cedar plugin (no existing test file). It
locks in the gate behavior so future refactors can't silently regress provider
compatibility.

### Step 3: Add `ud-server` environment to `buildCedarApp`

Edit `packages/vite/src/buildApp.ts`:

- [ ] Import `catchAllEntry` and `getAllEntries` from `@universal-deploy/store`.
- [ ] Import `catchAll` from `@universal-deploy/vite`.
- [ ] Add `ud?: boolean` to `BuildCedarAppOptions`.
- [ ] Add the `ud-server` environment declaration (conditional on
      `ud && workspace.includes('api')`).
- [ ] Add the `cedar-ud-inject-catchall` plugin (conditional on `ud`).
- [ ] Add the `cedar-ud-verify-routes` plugin (conditional on `ud`).
- [ ] Add the `cedar-ud-write-package-json` plugin (conditional on `ud`, with
      `applyToEnvironment(env) { return env.name === 'ud-server' }`).
- [ ] Add the `ud-server` build call to the `cedar-build-app` handler.
- [ ] Confirm the existing default-`ssr` environment deletion in
      `cedar-build-app-cleanup` still applies (it does — `ud-server` is not
      named `ssr`).

### Step 4: Write the fixture generation script

Create `tasks/test-project/generate-fixture-ud-netlify.mts`. The script copies
`__fixtures__/test-project-esm/` to `__fixtures__/test-project-esm-ud-netlify/`
and applies the UD Netlify delta (same packages and vite config changes as
`yarn cedar setup deploy netlify --ud`, per
`packages/cli/src/commands/setup/deploy/providers/netlifyHandler.ts`).

The script must mirror exactly what the setup command produces so the fixture
stays representative of a real user project after `setup deploy netlify --ud`.

```ts
import fs from 'node:fs'
import path from 'node:path'

const base = path.join(
  import.meta.dirname,
  '..',
  '..',
  '__fixtures__',
  'test-project-esm'
)
const dest = path.join(
  import.meta.dirname,
  '..',
  '..',
  '__fixtures__',
  'test-project-esm-ud-netlify'
)

// ---------- copy base fixture ----------
fs.cpSync(base, dest, { recursive: true, force: true })

// ---------- add netlify deps to package.json ----------
const pkgPath = path.join(dest, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
pkg.devDependencies ??= {}
pkg.devDependencies['@netlify/vite-plugin'] = '^0.x'
pkg.devDependencies['@universal-deploy/netlify'] = '^0.x'
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// ---------- update web/vite.config.ts ----------
const vitePath = path.join(dest, 'web', 'vite.config.ts')
let viteConfig = fs.readFileSync(vitePath, 'utf-8')

// Add import statements before the vite import.
viteConfig = viteConfig.replace(
  /(import\s+\{[^}]*\}\s+from\s+['"]vite['"];?)/,
  "import netlify from '@netlify/vite-plugin'\n" +
    "import netlifyCompat from '@universal-deploy/netlify/vite'\n" +
    '$1'
)

// Add netlify plugins before cedar() in the plugins array.
viteConfig = viteConfig.replace(
  /(cedar\(\{ mode \}\))/,
  'netlify({ build: { enabled: true } }),\n    netlifyCompat(),\n    $1'
)

fs.writeFileSync(vitePath, viteConfig)

console.log(`Wrote ${dest}`)
```

The fixture is not checked in manually. It is generated from the base fixture
and can be regenerated on demand:

```bash
node tasks/test-project/generate-fixture-ud-netlify.mts
```

The generated fixture is checked into version control so vitest can copy it to a
temp dir and run `cedar build --ud` in seconds, without the overhead of
`yarn cedar setup deploy netlify --ud` (which installs packages and rewrites
configs). To keep the fixture in sync with the base `test-project-esm`,
regenerate it whenever the base fixture is rebuilt (either manually or by adding
this invocation to the rebuild CI step).

### Step 5: Add a structural assertion test for `buildCedarApp({ ud: true })`

Create `packages/vite/src/buildApp.test.ts`:

- [ ] Copy `__fixtures__/test-project-esm/` to a temp dir.
- [ ] Install Cedar packages via tarsync (or rely on workspace linkage from the
      monorepo).
- [ ] Set `process.env.CEDAR_API_ROOT_PATH = '/.api/functions'` (matches the e2e
      workflow flag).
- [ ] Invoke
      `buildCedarApp({ ud: true, workspace: ['api', 'web'], verbose: false })`.
- [ ] Assert `web/dist/index.html` exists and contains `id="cedar-app"`.
- [ ] Assert `api/dist/index.js` (or the equivalent `api` env entry file)
      exists.
- [ ] Assert `api/dist/ud/index.js` exists.
- [ ] Assert `api/dist/ud/package.json` exists, parses, and contains
      `{ "type": "module" }`.
- [ ] Assert `api/dist/ud/chunks/` contains one handler chunk per route
      registered in `api/src/functions/`.

This is the strongest regression test for the migration: it asserts the exact
output structure the rest of the pipeline (serve, deploy) depends on. A change
that produces wrong output locations or missing files would fail here, before
the slower e2e tests catch it.

### Step 6: Wire up the CLI build handler

Edit `packages/cli/src/commands/build/buildHandler.ts`:

- [ ] Remove
      `import { buildUDApiServer } from '@cedarjs/vite/buildUDApiServer'`.
- [ ] Remove the second Listr task (lines 398-404, "Bundling API server entry
      (Universal Deploy)...").
- [ ] Pass `ud: true` to `buildCedarApp` (line 380).

The `CEDAR_API_ROOT_PATH` env var at buildHandler.ts:411-413 is set after the
tasks array is constructed but before `jobs.run()` is called (line 422), so the
value is available to `cedarUniversalDeployPlugin`'s constructor when
`buildCedarApp` runs. No change to the env var mechanism is needed.

### Step 7: Clean up `buildUDApiServer`

- [ ] Delete `packages/vite/src/buildUDApiServer.ts`.
- [ ] Remove the `./buildUDApiServer` export from `packages/vite/package.json`.
- [ ] Confirm `packages/vite/src/index.ts` does not re-export `buildUDApiServer`
      (it does not — `index.ts` re-exports `buildCedarApp` from
      `build/build.ts`).

### Step 8: Update existing build test snapshot

Edit `packages/cli/src/commands/build/__tests__/build.test.ts`:

- [ ] Update the "UD server entry task is included when --ud is passed" test
      (line 233) to expect a single `"Building App..."` task. The expected new
      inline snapshot is:

```ts
expect(tasks.map((x: ListrTask) => x.title)).toMatchInlineSnapshot(`
  [
    "Generating Prisma Client...",
    "Verifying graphql schema...",
    "Building App...",
  ]
`)
```

- [ ] The `"Bundling API server entry (Universal Deploy)..."` task title is
      gone; the test must drop it from the expected list.

### Step 9: Verify provider plugin compatibility

Run these locally before pushing:

- [ ] `cedar build --ud` with `vite-plugin-vercel` in the user config — verify
      `.vercel/output/config.json` and `api/dist/ud/index.js` both exist, and
      that the vercel functions build (use
      `node tasks/vercel-tests/local-test.mts` to exercise this end-to-end
      without deploying).
- [ ] `cedar build --ud` with `@netlify/vite-plugin` in the user config — verify
      the netlify output is produced (run against the fixture generated in Step
      4, or use `node tasks/netlify-tests/local-test.mts`).
- [ ] `cedar build --ud` with no provider plugins — verify the UD Fetchable is
      produced and functional (use the `__fixtures__/test-project-esm` and
      `tasks/ud-tests/udServe.test.mts`).

### Step 10: Quantify the "slower builds" claim

Before the change:

```bash
cd local-testing-project
time yarn cedar build --ud --apiRootPath=/.api/functions
```

After the change, run the same command in the same project. Record the delta.
Add the before/after numbers to the PR description as evidence for the "slower
builds" motivation. The expected improvement is the time to load the user's
config, resolve plugins, and run Rollup once instead of twice (roughly 5-15
seconds on a typical project, more on cold caches).

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

And the provider-plugin local tests (exercises the build path with a provider
plugin in the user config):

```bash
node tasks/netlify-tests/local-test.mts
node tasks/vercel-tests/local-test.mts
```

The full e2e coverage (deploys to real platforms) is gated on
`NETLIFY_AUTH_TOKEN` / `VERCEL_TOKEN` and runs via the `e2e-netlify` and
`e2e-vercel` CI jobs in `.github/workflows/ci.yml`. These are the highest-
confidence tests and should not be skipped.

## Future work (not in scope)

- **Unified dev server**: The dev path (`cedar dev --ud`) already uses a single
  Vite dev server (`cedar-unified-dev.ts`). This plan doesn't change it.
- **Single-port serve**: The serve path (`cedar serve --ud`) remains two-port
  with srvx on both ports. A future change could add single-port mode.
- **Phase 6: Route registration formalization**: Per-route UD entry registration
  is deferred to a separate plan.
- **De-duplicate `catchAll` instances in user-land**: The detect-and-inject
  pattern in `cedar-ud-inject-catchall` is a Cedar-side workaround. The
  underlying duplication concern is in `@universal-deploy/vite`'s API surface
  (no `apply` filter on `catchAll`); a future change could add an
  `apply: 'build'` filter upstream to make injection safe by default.
