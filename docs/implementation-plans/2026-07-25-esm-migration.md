Here's the breakdown of the 74 packages in the CedarJS monorepo:

CJS Only (2)

- cookie-jar
- server-store

ESM Only (60)

- cli
- codemods
- core
- create-cedar-app
- create-cedar-rsc-app
- framework-tools
- realtime
- storybook
- structure
- utils
- eslint-plugin (https://github.com/cedarjs/cedar/pull/2206)
- telemetry (https://github.com/cedarjs/cedar/pull/2204)
- tui (https://github.com/cedarjs/cedar/pull/2205)
- web-server (https://github.com/cedarjs/cedar/pull/2207)
- mailer-core (https://github.com/cedarjs/cedar/pull/2211)
- mailer-handler-in-memory (https://github.com/cedarjs/cedar/pull/2212)
- mailer-handler-nodemailer (https://github.com/cedarjs/cedar/pull/2215)
- mailer-handler-resend (https://github.com/cedarjs/cedar/pull/2216)
- mailer-handler-studio (https://github.com/cedarjs/cedar/pull/2217)
- mailer-renderer-mjml-react (https://github.com/cedarjs/cedar/pull/2218)
- mailer-renderer-react-email (https://github.com/cedarjs/cedar/pull/2219)
- auth-auth0-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-auth0-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-azure-active-directory-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-azure-active-directory-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-clerk-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-clerk-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-custom-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-dbauth-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-dbauth-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-firebase-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-firebase-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-netlify-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-netlify-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-supabase-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-supabase-setup (https://github.com/cedarjs/cedar/pull/2223)
- auth-supertokens-api (https://github.com/cedarjs/cedar/pull/2223)
- auth-supertokens-setup (https://github.com/cedarjs/cedar/pull/2223)
- fastify-web (adapters/fastify/web) (https://github.com/cedarjs/cedar/pull/2227)
- cli-data-migrate (https://github.com/cedarjs/cedar/pull/2227)
- cli-storybook-vite (https://github.com/cedarjs/cedar/pull/2227)
- auth-auth0-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-azure-active-directory-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-clerk-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-dbauth-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-dbauth-middleware (https://github.com/cedarjs/cedar/pull/2234)
- auth-firebase-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-netlify-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-supabase-web (https://github.com/cedarjs/cedar/pull/2234)
- auth-supabase-middleware (https://github.com/cedarjs/cedar/pull/2234)
- auth-supertokens-web (https://github.com/cedarjs/cedar/pull/2234)
- cli-helpers (https://github.com/cedarjs/cedar/pull/2237)
- context (https://github.com/cedarjs/cedar/pull/2237)
- gqlorm (https://github.com/cedarjs/cedar/pull/2237)
- internal (https://github.com/cedarjs/cedar/pull/2237)
- vite (https://github.com/cedarjs/cedar/pull/2237)
- babel-config (https://github.com/cedarjs/cedar/pull/2239)
- forms (https://github.com/cedarjs/cedar/pull/2239)
- jobs (https://github.com/cedarjs/cedar/pull/2239)
- ogimage-gen (https://github.com/cedarjs/cedar/pull/2239)

Dual Mode – CJS + ESM (12)

- api
- api-server
- auth
- eslint-config
- graphql-server
- prerender
- project-config
- record
- router
- storage
- testing
- web

Summary: Of the 74 packages, 12 are dual mode (CJS + ESM), 2 are CJS-only, and
60 are ESM-only. Of the 6 packages that were previously miscategorized as
Dual Mode but were actually CJS-only the whole time (`babel-config`,
`cookie-jar`, `forms`, `jobs`, `ogimage-gen`, `server-store` — see the
correction below), 4 have now been converted to ESM-only (see "CJS Only ->
ESM Only: the 6 miscategorized packages" below); `cookie-jar` and
`server-store` are a deliberate exception, held back pending a decision (see
below) — same shape as the `prerender` exception, but discovered later, on
its own PR, after CI (not local verification) caught it. Of the packages
that were genuinely CJS-only in the original inventory, all 27 have now been
converted to ESM-only, and 15 of the 17 packages that used to be genuinely
Dual Mode have also been converted to ESM-only (see "Dual Mode -> ESM Only"
below) — most were dual mode from a mechanical Babel-to-esbuild tooling
migration, not because anything actually needed a CJS build of them.
`prerender` is a deliberate exception, held back pending a decision (see
below). ESM-only remains the packages that have been explicitly converted to
drop their CJS build entirely; `eslint-plugin`, `telemetry`, `tui`,
`web-server`, the 7 `mailer/*` packages, the 17 `auth-*-api`/`auth-*-setup`
packages, `fastify-web`/`cli-data-migrate`/`cli-storybook-vite`, the 10
`auth-*-web`/`auth-*-middleware` packages,
`cli-helpers`/`context`/`gqlorm`/`internal`/`vite`, and
`babel-config`/`forms`/`jobs`/`ogimage-gen` are the conversions done so far.

**Correction (2026-07-25 review):** an earlier revision of this doc listed
`cli-helpers`, `context`, and `record` under ESM Only, and listed
`testing/config/jest/api` and `testing/config/jest/web` as standalone CJS-only
packages. Neither holds up:

- `cli-helpers`, `context`, and `record` all still build both an ESM and a CJS
  output (`build.ts`/`build.mts` call `build()`/`buildEsm()` followed by a
  second pass with `format: 'cjs'` or `buildCjs()`, and their `package.json`
  `exports` maps point `import` at `dist/*.js` and `require`/`default` at
  `dist/cjs/*.js`). They belong in Dual Mode, not ESM Only.
- `testing/config/jest/api/package.json` and `testing/config/jest/web/package.json`
  are not independent packages — they're not listed in the root `workspaces`
  globs, and `@cedarjs/testing`'s own `package.json` ships them via its
  `"files": ["config", "dist"]` entry. They're nested marker `package.json`
  files (same purpose as `web/toast/package.json` and `web/apollo/package.json`,
  which were correctly excluded), used only so
  `require('@cedarjs/testing/config/jest/api')` resolves a subpath — not
  packages that could themselves be "converted" to ESM. They've been removed
  from the inventory.

**Correction (2026-07-26 review):** research into which Dual Mode packages
were good candidates to drop their CJS build turned up 6 packages that were
never actually dual mode at all — they were CJS-only the whole time, just
miscategorized:

- `babel-config`: `package.json` `"type": "commonjs"`, `exports` only declares
  `"." : "./dist/index.js"`, and `build.mts` calls the bare `build()` helper,
  whose `defaultBuildOptions` default to `format: 'cjs'` — no ESM build is
  ever produced.
- `cookie-jar`: `build.mts` always builds `format: 'cjs'` only, and has done
  so since the file was first added.
- `forms`: same pattern — bare `build()` call, `exports["."]` has only a
  `default` condition, no `import` condition.
- `jobs`: bare `await build()` with no format override, root `"type":
"commonjs"`, single flat `exports` condition.
- `ogimage-gen`: same — `build.mts` is a bare `build()` call, `"type":
"commonjs"`. It does have vestigial dual-mode-looking scaffolding (an
  `exports["./middleware"].import` condition and a `cjsWrappers/` directory),
  but both point at the same CJS output — leftover/unfinished work, not a
  real ESM build.
- `server-store`: `build.mts` explicitly sets `format: 'cjs'`, single output,
  root `"type": "commonjs"`.

Moved all 6 to CJS Only. This also means they're candidates for the
CJS-only-to-ESM-only conversion described below, following the same Node
24-`require(esm)` reasoning as the original 27 — not yet evaluated in detail.

## CJS Only -> ESM Only: candidates given the Node 24 requirement

CedarJS has a hard requirement on Node 24 (`node: "=24.x"` in the generated
project templates, `node: ">=24"` in `create-cedar-app`), which has unflagged
support for `require(esm)` — a CJS `require()` call can now synchronously load a
real ESM module, as long as that module (and its transitive graph) has no
top-level `await`. This removes the original reason most of the 27
originally-CJS-only packages were left CJS-only: they didn't need a parallel
CJS build because nothing was actually blocked from `require()`-ing an ESM
build anymore.

Checking actual consumers of the (originally) 27 CJS-only packages across the
monorepo and generated templates:

- **`mailer-core`, `mailer-handler-*`, `mailer-renderer-*`**: the only
  `require()` calls found anywhere are two lazy, try/catch-wrapped lookups in
  `packages/mailer/core/src/mailer.ts` (feature-detecting the optional
  `mailer-handler-in-memory` and `mailer-handler-studio` packages). Neither
  handler module has top-level `await`. Safe to convert.
- **`fastify-web`**: every consumer (`api-server`, `web-server`) already uses
  `import`, never `require()`. Safe, essentially risk-free. **Done** (#2227).
- **`cli-data-migrate`, `cli-storybook-vite`**: loaded by the CLI via
  `await import(packageName)` (dynamic ESM import) in
  `packages/cli/src/lib/plugin.ts`, not `require()`. Safe, risk-free.
  **Done** (#2227).
- **`auth-*-api` / `auth-*-setup`** (17 packages): pulled into generated user
  apps. The non-ESM ("commonjs") templates transpile the user's `import`
  statements to `require()` via Babel at build time, so this is the one place a
  real cross-boundary `require()` of these packages happens today. Under Node 24
  that now resolves via `require(esm)` instead of throwing `ERR_REQUIRE_ESM`.
  Safe given the Node 24 floor, but end-user-facing — worth a smoke test against
  a generated commonjs-template project before converting. **Done** (#2223).

**Conclusion**: all 27 originally-CJS-only packages are viable candidates for
conversion to ESM-only. Suggested sequencing, low-risk first:

1. `mailer-core`, `mailer-handler-in-memory`, `mailer-handler-nodemailer`,
   `mailer-handler-resend`, `mailer-handler-studio`,
   `mailer-renderer-mjml-react`, `mailer-renderer-react-email` — no real
   external `require()` callers found at all. **Done** (PRs #2211, #2212,
   #2215–#2219).
2. The 17 `auth-*-api` / `auth-*-setup` packages — mechanically identical
   conversion, batch together, smoke-test against a generated commonjs template
   project. **Done**, batched into a single PR (#2223).
3. `fastify-web`, `cli-data-migrate`, `cli-storybook-vite` — no real external
   `require()` callers found at all. **Done** (#2227).

## Dual Mode -> ESM Only: the auth-provider `-web`/`-middleware` packages

With the CJS-only inventory fully converted, the next question was whether
the remaining Dual Mode packages could also drop their CJS build. Framework
packages like `cli-helpers`, `context`, `record`, `api`, `api-server`, etc.
have real reasons to stay dual mode (they're consumed in contexts that
genuinely need both formats). The 10 `auth-*-web` / `auth-*-middleware`
packages turned out not to:

- **`auth-*-web`** (8 packages): only ever consumed by generated project
  templates (`web/src/auth.ts.template`) via a plain `import`, which Vite/
  Rollup statically bundles into the client and SSR/streaming bundles.
  Nothing `require()`s them — the `auth-*-setup` packages only ever reference
  them by name in a `webPackages` string array passed to the installer, never
  actually import them. Their `package.json` `exports` maps only ever exposed
  an `import` condition plus a CJS `default` fallback — no external consumer
  was ever expected to hit the CJS build.
- **`auth-dbauth-middleware`, `auth-supabase-middleware`**: loaded server-side
  via `viteDevServer.ssrLoadModule` in dev and dynamic `import()` of the built
  `.mjs` entry in prod (`packages/vite/src/middleware/register.ts`), and
  statically bundled by Rollup for the SSR/streaming builds same as the `-web`
  packages. The CJS build's only real trigger was a _build-time_ TypeScript
  constraint (`tsc`'s node16 CJS emit refusing to statically compile a
  `require()` of an already-ESM-only dependency, the same `TS1479` class of
  issue hit when `auth-dbauth-api` went ESM-only in #2223) — not a runtime
  consumer.
- Git history confirms the CJS build was mechanical, not driven by a
  discovered caller: these packages picked up a dual ESM+CJS build as part of
  a repo-wide Babel-to-esbuild tooling migration, and the
  `vite-plugin-cjs-interop` config's `'@cedarjs/auth-!(dbauth)-web'` glob is
  itself evidence of the pattern — narrowed once already (dropping `dbauth-web`
  when it got a real ESM build with proper named exports), and now dropped
  entirely as all of them have gone ESM-only.

All 10 packages converted cleanly: `package.json` `exports` maps collapsed
from `{import: ..., default/require: <cjs>}` to a single `default` condition,
`build.ts`/`build.mts` dropped their `buildCjs()`/`buildExternalCjs()` +
`generateTypesCjs()` + `insertCommonJsPackageJson()` calls, `tsconfig.cjs.json`
files removed, and the stale `cjsInterop` glob entries removed from
`packages/vite/src/{devFeServer,streaming/buildForStreamingServer,rsc/rscBuildForSsr}.ts`.

## Dual Mode -> ESM Only: the remaining framework packages

With the auth-provider packages done, research into the rest of the Dual Mode
list (`docs` research, not yet a PR at the time) sorted the remaining 17 into
tiers by risk. Tier 1 — packages with no coupling to other Dual Mode packages
and no real `require()` consumer found anywhere — converted cleanly:

- **`context`, `gqlorm`, `internal`**: standard `buildEsm()`/`buildExternalEsm()`
  conversions, no real consumers doing a synchronous `require()`.
- **`cli-helpers`**: same pattern; also had one real `require('../../package.json')`
  call (`src/lib/project.ts`) reading its own version — replaced with
  `fs.readFileSync` + `JSON.parse`, since plain `require()` isn't a global in
  real ESM.
- **`vite`**: its `build.ts` already excluded several entry files
  (`devFeServer.ts`, `runFeServer.ts`, etc.) from the CJS build with a comment
  explaining they're only ever reached through ESM-only bins — direct evidence
  the CJS build was already vestigial for part of the package. Also never
  generated real CJS type declarations of its own; it manually wrote
  `export type * from "../x.d.ts"` re-export stubs pointing at the ESM
  declarations, meaning the "CJS" types were always just the ESM ones,
  re-exported. Dropping the CJS build removes a documented workaround rather
  than creating a new risk.

**Real gotcha found and fixed**: `@cedarjs/context` going ESM-only broke
generated projects' **api-side** Jest tests the same way the `-web` packages
broke web-side tests in #2234 — `@cedarjs/testing`'s own api entry point does
a top-level `require("@cedarjs/context")` in its CJS build (used by
`packages/testing/src/api/directive.ts`, pulled in by virtually every
api-side test via `@cedarjs/testing/api`), and Jest's CJS runtime can't parse
the real ESM this now emits. Unlike the web preset, the **api-side** Jest
preset (`packages/testing/src/config/jest/api/jest-preset.ts`) had **no**
`transformIgnorePatterns` override at all before this — built one from
scratch, mirroring the web-side pattern, carving out `@cedarjs/context`
specifically (confirmed via `require("@cedarjs/...")` greps through
`@cedarjs/testing`'s compiled CJS output that none of the other 4 packages in
this batch are transitively required by it).

**Held back: `prerender`.** Initial research called this "the cleanest of the
batch," based on its consumer (`prerenderHandler.ts`) already branching
between `import('@cedarjs/prerender/...')` and
`import('@cedarjs/prerender/cjs/...')` at runtime. Closer inspection found
that's true of the _consumer_, but not of the package itself:
`src/runPrerender.tsx` (the CJS/`require` entry) and `src/runPrerenderEsm.tsx`
(the ESM/`import` entry) are **not** the same source built twice — they're
genuinely different implementations. The CJS version uses
`registerApiSideBabelHook()`/`registerWebSideBabelHook()` (Babel-register
hooks + `require()`) to transform and load the user's app; the ESM version
uses a `NodeRunner` class and a `buildAndImport()` helper that writes a
temporary combined entry file and loads it via Vite/Rollup instead. Dropping
the CJS build here wouldn't just remove a redundant build target — it would
retire an entire alternate prerendering implementation that classic CJS-mode
projects may still depend on. That's a real product decision, not a
mechanical cleanup, so it's out of scope for this round.

## Dual Mode -> ESM Only: the original tiered roadmap (Tiers 2-3 not yet done)

The research that produced the Tier 1 list above actually ranked the whole
remaining Dual Mode pool by readiness, not just Tier 1. Recorded here since
only Tier 1 has been acted on so far — Tiers 2 and 3 are still open:

**Tier 1 — no known prerequisites** (see above for what actually happened —
5 of these 6 converted cleanly; `prerender`, despite looking like the
easiest of the batch here, turned out to have a genuinely different CJS
implementation and was held back):
`context`, `cli-helpers`, `gqlorm`, `internal`, `vite`, `prerender`.

**Tier 2 — one small fix needed first:**

- `web` — needs the web-side Jest preset carve-out (the same
  `transformIgnorePatterns` mechanism used for `until-async`/`auth-*-web`,
  and later for `forms` in #2239) extended to cover it, since generated
  projects' web tests import it directly and unmocked.
- `auth` + `router` (move together — `router` has a real value-import of
  `auth`) — need the static imports in `router`/`web`'s own source
  converted away from plain `import` first, to avoid the `TS1479` class of
  break in their own CJS type-declaration builds. This is the same
  structural problem that blocked `cookie-jar`/`server-store` in #2239 (see
  "Held back" above) — except here it's `router`/`web`'s **own** conversion
  that needs the fix, not a dependency's. Converting `router`/`web` this way
  would, as a side effect, remove the thing currently blocking
  `cookie-jar`/`server-store` too (see the note at the end of the "Held
  back" section above).

**Tier 3 — bigger prerequisite, worth starting but flagging:**

- `project-config` + `api` — both are dependency-graph leaves, good places
  to start an API-side batch, **but** the api-side Jest preset had **no**
  `transformIgnorePatterns` override at all at the time of this research —
  the carve-out mechanism that made the web-side conversions safe didn't
  exist yet on the API side. (It's since been built — see `@cedarjs/context`
  in #2237 — so this specific prerequisite is now satisfied; `project-config`
  and `api` themselves are still unconverted.) `graphql-server`, `storage`,
  and `api-server` are tightly coupled to these two and should follow in the
  same batch once `project-config`/`api` are done.

**Flagged to leave alone at the time:** `babel-config` (reasoned to sit
underneath Jest's own CJS preset loading, ESLint's config loader, and a
Babel-register bootstrap hook simultaneously — too much blast radius to
tackle casually), `testing` (self-referential — its own `jest.setup.js`
requires its own `dist/cjs/*` paths), and `eslint-config` (not really "dual
mode" in the risky sense — it's intentionally separate CJS/ESM entry files
for `.eslintrc` vs flat-config consumers, not a leftover CJS build).
**`babel-config` was in fact converted in #2239**, using `createRequire()`
to route its (necessarily synchronous) internal `require()` calls through a
real function instead of the nonexistent CJS global — the caution here was
reasonable given the blast radius, but the actual fix turned out to be more
tractable than expected. `testing` and `eslint-config` remain unconverted
and the reasoning above still applies to both.

## CJS Only -> ESM Only: the 6 miscategorized packages

Of the 6 packages moved from Dual Mode to CJS Only in the 2026-07-26
correction above (`babel-config`, `cookie-jar`, `forms`, `jobs`,
`ogimage-gen`, `server-store`), 4 converted cleanly to ESM-only following the
same Node 24 `require(esm)` reasoning as the original 27. `cookie-jar` and
`server-store` were held back — see below.

- **`forms`**: no real `require()` callers found anywhere. Converted with no
  code changes beyond build config.
- **`ogimage-gen`**: real consumers only ever `import` its subpaths (codemods
  insert plain `import` statements into the user's `vite.config.ts`/
  middleware file). The package's own `exports` map had vestigial dual-mode
  scaffolding flagged in the correction above — an `import` condition next to
  a `default` condition pointing at hand-written `cjsWrappers/*.js` files that
  just did `require('../dist/x.js').default`, unwrapping a CJS dist file that
  was already the only real build output. Both conditions pointed at the same
  CJS content; removed the `cjsWrappers/` directory entirely and collapsed
  `exports` to a single `default` condition per subpath.
- **`jobs`**: no external `require()` callers, but two real CJS-isms inside
  the package's own bin scripts (executed directly by `node`, not detected by
  a grep for cross-package `require()`):
  - `src/bins/cedar-jobs.ts` used `__dirname` to locate the worker script —
    not a global in real ESM. Replaced with `import.meta.dirname`.
  - `src/bins/rw-jobs-worker.ts` (the deprecated `rw-jobs-worker` bin) did
    `require('./cedar-jobs-worker.js')` to delegate to the renamed bin.
    Replaced with `await import('./cedar-jobs-worker.js')` — safe because
    this file is only ever executed directly as an entry script (via the
    `rw-jobs-worker` bin symlink), never `require()`'d by another module, so
    top-level `await` doesn't create a `require(esm)` hazard for it.
  - Verified both fixes with real runtime smoke tests (not just unit tests):
    ran the built `cedar-jobs.js` and `rw-jobs-worker.js` directly with
    `node`, and separately exercised the exact `createRequire()`-based
    `require(esm)` path `@cedarjs/core`'s `cedar-jobs`/`cedar-jobs-worker`/
    `rw-jobs-worker` bin proxies use to load into the jobs package's bins.
    Both come back clean — no `ReferenceError`, and no top-level `await` on
    the modules those proxies `require()` (only `rw-jobs-worker.ts`, which
    is never `require()`'d, has one).
- **`babel-config`**: the one real blocker candidate, and worth spelling out
  because it's a materially bigger change than the previous conversions.
  `src/common.ts` and `src/web.ts` make **5 real `require()` calls** —
  loading sibling Babel plugin files and, in one case, a **user's**
  `babel.config.js` at a dynamically-computed path. These aren't consumer-side
  `require()`s hitting a build-time or Jest-runtime wall like every previous
  conversion in this doc — they're calls the package makes internally, and
  they can't simply become `import()`: the functions that contain them
  (`getWebSideBabelPlugins`, `getWebSideBabelPresets`, `registerBabel`) are
  called synchronously and return plain objects, because that's the shape
  Babel's own config API requires. Threading `async`/`await` through them
  would ripple out through every caller (Jest preset config building, `@babel/
register`'s hook installation) — a real invasive change, not a mechanical
  one.

  The fix: `const require = createRequire(import.meta.url)` at the top of
  both files, shadowing the (nonexistent) global with a real synchronous
  `require` function. This is the same technique `@cedarjs/core`'s `src/bins/
*.ts` proxy scripts already use, and it works for all 5 call sites
  unchanged, including the dynamic user-config path — `createRequire`'s
  `require()` supports `require(esm)` the same as the CJS global does, so it
  transparently handles a user's `babel.config.js` regardless of whether
  that's CJS or ESM (as long as it has no top-level `await`, which config
  files never do in practice).

  Two more things fell out of converting `babel-config`:
  - `src/plugins/babel-plugin-redwood-mock-cell-data.ts` did
    `import traverse from '@babel/traverse'` and called `traverse(...)`
    directly. Under `verbatimModuleSyntax: true` (part of the ESM-only
    tsconfig base, not set by the old CJS-only config) this became a type
    error — `@types/babel__traverse`'s default export type isn't callable
    through that combination of module settings. `packages/internal/src/
ast.ts` (already ESM-only) hits the exact same `@babel/traverse` default-
    export ambiguity and already has the fix: unwrap with
    `const traverse = babelTraverse.default || babelTraverse`. Applied the
    same pattern here.
  - `src/plugins/prettier.config.js` did `module.exports = config` — a
    genuine CommonJS file sitting directly in `src/`, picked up by
    `babel-plugin-tester`'s Prettier formatting via Prettier's own
    `cosmiconfig`-based config discovery, not by anything in `babel-config`'s
    own module graph. Once the package is `"type": "module"`, a plain `.js`
    file using `module.exports` needs the `.cjs` extension to still be
    treated as CommonJS — the same fix already applied to the equivalent
    fixture files in `prerender`/`testing`
    (`src/babelPlugins/prettier.config.cjs`,
    `src/config/jest/babelPlugins/prettier.config.cjs`). Renamed to
    `prettier.config.cjs`.

  Verified end-to-end at runtime, not just via the unit test suite: with
  `babel-config` rebuilt as ESM-only, ran the real compiled consumer chains
  from a project directory with a `cedar.toml`, requiring exactly what Jest
  and ESLint require in a generated project —
  `@cedarjs/testing/config/jest/api/jest-preset.js`,
  `@cedarjs/testing/config/jest/web/jest-preset.js`, and
  `@cedarjs/eslint-config/index.js` — all three load cleanly via `require(esm)`
  through their own genuine CJS output (these are real CJS files regardless of
  the root package's `type` field, per the `testing/config/jest/{api,web}/
package.json` marker files noted in the 2026-07-25 correction above). Also
  called `getApiSideDefaultBabelConfig()`/`getWebSideDefaultBabelConfig()`
  directly and confirmed the returned plugin arrays are fully populated (the 5
  `require()`'d plugins all resolve), and called `registerBabel()` directly to
  confirm the `@babel/register` hook installs without error.

The 4 converted (`babel-config`, `forms`, `jobs`, `ogimage-gen`) all follow
the same shape: `package.json` `type` flipped to `module`, `exports` maps
collapsed to `default`-only conditions, `build.mts` switched to calling
`buildEsm()` and `generateTypesEsm()`, `tsconfig.json` `extends` switched
from the `cjs-base`/`cjs-build-base` variants to the plain `base`/
`build.base` ones, and (for the packages that never had one) a
`tsconfig.build.json` added following the same shape used by the other
ESM-only packages in this doc.

**Held back: `cookie-jar` and `server-store`.** The initial consumer check
for these two only looked for `require()` calls in other packages' **JS**
output, the same check that correctly cleared the other 4. That missed a
different failure mode: two dual-mode packages — `router` and `web` — also
run a **separate `tsc --build` pass just to generate their CJS `.d.ts`
files** (`build:types-cjs`, using `tsconfig.cjs.json`), independent of their
esbuild-emitted CJS **JS**. `router/src/rsc/ServerRouter.tsx` does
`import { getAuthState, getLocation } from '@cedarjs/server-store'`, and
`web/src/server/{MiddlewareRequest,MiddlewareResponse}.ts` do
`import { CookieJar } from '@cedarjs/cookie-jar'` — real, static value
imports, in files that go through that CJS declaration build. Once
`cookie-jar`/`server-store` went ESM-only, both hit the same `TS1479` class
of break as `auth-dbauth-middleware` in #2223 — `tsc`'s CJS emit mode refuses
to statically type a `require()` of an already-ESM-only dependency, even
though Node 24's `require(esm)` would handle it fine at runtime. This one
slipped past local verification too: `yarn build` locally came back clean
because Nx's incremental `tsc` build info for `router`/`web` was stale from
before the `cookie-jar`/`server-store` changes and didn't get invalidated —
CI, running from a clean checkout, caught it immediately. Reproduced locally
after clearing the stale `.tsbuildinfo` files and `dist/` output.

Unlike `auth-dbauth-middleware` (#2223) or `router`'s own type-only imports
of `@cedarjs/server-store` elsewhere (which already use the established
`import type ... with { 'resolution-mode': 'import' }` escape hatch), this
isn't fixable by converting the value imports to dynamic `import()`:

- `getAuthState()`/`getLocation()` are called synchronously in three separate
  places in `ServerRouter.tsx` — inside the `Router` component's render body,
  and inside `hasRole()` and `AuthenticatedRoute`, which gate route-level
  authorization. `AuthenticatedRoute` in particular is a plain synchronous
  `React.FC`, not natively async-friendly, and no async Server Component
  pattern exists anywhere else in this codebase yet to model the change on.
  Making these async would mean redesigning how authorization checks happen
  during RSC route matching — a real product/architecture decision, not a
  mechanical fix.
- `CookieJar` is constructed with `new CookieJar(...)` directly inside
  `MiddlewareRequest`'s constructor and as a class field initializer on
  `MiddlewareResponse` — both foundational, extremely hot-path primitives
  constructed on every single request/response through Cedar's middleware
  pipeline. Class constructors can't be `async`, so the dynamic-`import()`
  pattern doesn't apply without a much larger refactor (async factory
  functions rippling out through the whole middleware call chain).

Reverted both to CJS-only (their pre-2026-07-26-correction build config) and
verified with a full clean rebuild (`yarn build:clean` — `git clean -fdx` +
reinstall + build from scratch, not just a cache-busted local build) plus
`yarn lint` and `yarn nx run-many -t test` with a 0% Nx cache hit rate, so
this doesn't repeat the stale-cache blind spot that let the break through
locally the first time.

The `createRequire()` trick that fixed `babel-config`'s equivalent problem
(see above) doesn't transfer here either, for a different reason than the
async one: `createRequire()` needs `import.meta.url`, which only exists in
real ESM. `babel-config` is ESM-only — one build, so `import.meta.url` is
always there. `router` and `web` are still dual-mode — the same source file
is compiled twice, once to real ESM and once to real CJS via esbuild. A
`createRequire(import.meta.url)` written into `ServerRouter.tsx` or
`MiddlewareRequest.ts` would ship in both outputs; in the CJS one, esbuild
substitutes `undefined` for `import.meta.url`, so `createRequire(undefined)`
would throw the moment a CJS-mode project actually hit that code path.

**This points at the actual unblock: `router` and `web` themselves going
ESM-only.** If they did, there'd be no more separate CJS `.d.ts` build for
either package to break in the first place — the `TS1479` failure mode
disappears entirely, and `cookie-jar`/`server-store` could then convert with
zero code changes, the same as `forms`/`jobs`/`ogimage-gen` did. That's a
much bigger call than this one, though: `router` and `web` are two of the
most foundational packages in the framework, consumed by every generated
project including ones still on the CJS template, so it needs the same kind
of "does anything actually `require()` this synchronously in a way Node 24
can't handle" investigation the other conversions got — just at
higher stakes, and out of scope here. Worth its own round when it comes up.
