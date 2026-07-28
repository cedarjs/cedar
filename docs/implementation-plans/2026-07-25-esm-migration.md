Here's the breakdown of the 74 packages in the CedarJS monorepo:

Dual Mode – CJS + ESM (5)

- eslint-config
- prerender
- project-config
- record
- testing

CJS Only (2)

- cookie-jar
- server-store

ESM Only (67)

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
- auth (https://github.com/cedarjs/cedar/pull/2241)
- router (https://github.com/cedarjs/cedar/pull/2241)
- web (https://github.com/cedarjs/cedar/pull/2241)
- api (Tier 3, see "Dual Mode -> ESM Only: Tier 3" below)
- graphql-server (Tier 3, see "Dual Mode -> ESM Only: Tier 3" below)
- storage (Tier 3, see "Dual Mode -> ESM Only: Tier 3" below)
- api-server (Tier 3, see "Dual Mode -> ESM Only: Tier 3" below)

Summary: Of the 74 packages, 5 are dual mode (CJS + ESM), 2 are CJS-only, and
67 are ESM-only. The Dual Mode pool most recently dropped from 9 to 5 with the
Tier 3 batch (`api`, `graphql-server`, `storage`, `api-server` — see "Dual
Mode -> ESM Only: Tier 3" below); `project-config` was researched and
prototyped as part of the same batch but reverted and stays dual mode (see
that section for why). Of the 6 packages that were previously miscategorized as
Dual Mode but were actually CJS-only the whole time (`babel-config`,
`cookie-jar`, `forms`, `jobs`, `ogimage-gen`, `server-store` — see the
correction below), 4 have now been converted to ESM-only (see "CJS Only ->
ESM Only: the 6 miscategorized packages" below); `cookie-jar` and
`server-store` are a deliberate exception, held back pending a decision (see
below) — same shape as the `prerender` exception, but discovered later, on
its own PR, after CI (not local verification) caught it. Of the packages
that were genuinely CJS-only in the original inventory, all 27 have now been
converted to ESM-only, and the Dual Mode pool has gone from 23 packages down
to 9 (see "Dual Mode -> ESM Only" below) — most were dual mode from a
mechanical Babel-to-esbuild tooling migration, not because anything actually
needed a CJS build of them. `prerender` is a deliberate exception, held back
pending a decision (see below); `auth`/`router`/`web` — the original Tier 2
(see "the original tiered roadmap" below) — have now also been converted, on
top of the auth-provider batch and Tier 1. ESM-only remains the packages
that have been explicitly converted to drop their CJS build entirely;
`eslint-plugin`, `telemetry`, `tui`, `web-server`, the 7 `mailer/*` packages,
the 17 `auth-*-api`/`auth-*-setup` packages,
`fastify-web`/`cli-data-migrate`/`cli-storybook-vite`, the 10
`auth-*-web`/`auth-*-middleware` packages,
`cli-helpers`/`context`/`gqlorm`/`internal`/`vite`,
`babel-config`/`forms`/`jobs`/`ogimage-gen`, and `auth`/`router`/`web` are
the conversions done so far.

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

## Dual Mode -> ESM Only: the original tiered roadmap (Tier 2 now done)

The research that produced the Tier 1 list above actually ranked the whole
remaining Dual Mode pool by readiness, not just Tier 1. Recorded here since
Tier 3 is still open:

**Tier 1 — no known prerequisites** (see above for what actually happened —
5 of these 6 converted cleanly; `prerender`, despite looking like the
easiest of the batch here, turned out to have a genuinely different CJS
implementation and was held back):
`context`, `cli-helpers`, `gqlorm`, `internal`, `vite`, `prerender`.

**Tier 2 — one small fix needed first: done, see below for what actually
happened.** Original scoping:

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
  same batch once `project-config`/`api` are done. **`api` (plus
  `graphql-server`, `storage`, and `api-server`) were in fact converted this
  way — see "Dual Mode -> ESM Only: Tier 3" below. `project-config` was
  prototyped in the same batch and worked, but was reverted and stays dual
  mode by choice, not because of a technical blocker** — see that section.

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

## Dual Mode -> ESM Only: Tier 2 (`auth`, `router`, `web`)

Converted `auth`, `router`, and `web` together, following the scoping above,
plus fixes for a few things the original research didn't (couldn't) see
until the code was actually touched:

- **`auth`**: fully mechanical — no internal `require()`/`__dirname` usage,
  no consumer issues. `package.json` `exports` collapsed to `default`-only
  conditions, `build.ts` switched to `buildExternalEsm()` +
  `generateTypesEsm()`, `tsconfig.cjs.json` removed.
- **`router`**: same mechanical shape. Its own `router-context.tsx` does a
  real value import of `@cedarjs/auth` (`useNoAuth`) — as scoped, this
  needed no fix at all once `router` itself has no separate CJS
  declaration build to break: with `auth` converting in the same batch,
  there's no more `tsc --build tsconfig.cjs.json` step for either package to
  hit `TS1479` on. Confirmed by grepping for `require()`/`__dirname` in
  `router/src` (none) and by the build coming back clean.
- **`web`**: the real substance of this batch.
  - All 7 bin proxy scripts (`cedar`, `cedarjs`, `cfw`, `cross-env`, `msw`,
    `redwood`/`rw`, `storybook`, `tsc`) did a bare `require.resolve(...)` —
    fine today because they only ever shipped as CJS
    (`dist/cjs/bins/*.js`), but a `ReferenceError` waiting to happen once
    `web` has no CJS build. Fixed the same way as `babel-config`:
    `const require = createRequire(import.meta.url)` at the top of each
    file. Verified by running the built bins directly (`cedar --version`,
    `tsc --version`, `cross-env FOO=bar node ...`) from within a real
    generated project — all resolve correctly.
  - `build.ts` dropped its entire CJS build block, including a workaround
    that bundled `apollo-upload-client` (itself ESM-only) into a
    self-contained CJS chunk via `@hyrious/esbuild-plugin-commonjs`-style
    tooling, solely because the CJS build couldn't otherwise `require()` an
    ESM-only npm dependency. With no more CJS build,
    `src/bundled/apollo-upload-client.ts` is now just a normal file in the
    single ESM build — the workaround wasn't fixed, it stopped being necessary.
  - Added `@cedarjs/web`, `@cedarjs/auth`, and `@cedarjs/router` to the
    web-side Jest preset's `transformIgnorePatterns` carve-out (the same
    mechanism `forms` got in #2239) — `web` and `router` are imported
    directly by virtually every generated project's web-side test
    (`Routes.tsx`, page/component scaffolds), and `auth` gets pulled in
    transitively through `web`. Jest's own module loader re-applies the
    carve-out to every file it loads, including ones reached transitively
    through an already-transformed `require()` call, so all three needed to
    be listed even though only `web`/`router` are usually imported directly.
- **`prerender`** (stays dual mode): `src/runPrerender.tsx` had two real
  static value imports of `@cedarjs/router` (`LocationProvider`,
  `matchPath`) that would have hit `TS1479` in prerender's own CJS
  declaration build once `router` went ESM-only. Unlike `cookie-jar`/
  `server-store`, this one **was** fixable without a bigger refactor: the
  file already had a `require('@cedarjs/web')` call with a
  `// Load this async, to prevent rwjs/web being loaded before shims`
  comment — a deliberate pattern for deferring a require past
  `registerShims()`. Added `LocationProvider` to that same lazy
  `require('@cedarjs/router')` call inside the (already async)
  `recursivelyRender` function, and added a second lazy
  `require('@cedarjs/router/dist/util')` for `matchPath` inside
  `insertChunkLoadingScript` (a synchronous function — `require()`, not
  dynamic `import()`, was the right tool here specifically because it
  doesn't need the caller to become `async`).
- **`testing`** (stays dual mode): the original research flagged this as
  the same shape of blocker as `cookie-jar`/`server-store` —
  `MockProviders.tsx`/`MockParamsProvider.tsx`/`mockAuth.tsx` use
  `LocationProvider`/`RedwoodProvider` as JSX components, synchronously, so
  dynamic `import()` wouldn't work without breaking every test that renders
  `<MockProviders>`. The plan going in was to switch `testing`'s CJS side to
  hand-written `.d.ts` re-export stubs pointing at the ESM declarations (the
  same trick `vite` used before it went ESM-only), sidestepping `tsc`'s CJS
  declaration build entirely for these files.
  **That plan turned out to be unnecessary.** Empirically, `testing`'s real
  `tsc --build tsconfig.cjs.json` pass — run through the actual
  `generateTypesCjs()` build step, package.json `type` flip included — does
  **not** error on these files, even with `auth`/`router`/`web` fully
  ESM-only. Verified this wasn't a stale-cache false negative (this
  migration's most consistent failure mode) by deliberately introducing a
  typo into `MockProviders.tsx`'s import and confirming `tsc` still caught
  it — real type-checking is active, it just doesn't hit `TS1479` here. The
  likely reason: `TS1479` fires specifically when a package's conditional
  `exports` has an `import` condition but explicitly no `require` condition,
  forcing Node's own `require()` algorithm to fail before Node 24's
  `require(esm)` gets a chance to help. `auth`/`router`/`web` (like every
  other ESM-only package in this migration) collapse to a single `default`
  condition instead, which — unlike an explicit `import`-only condition —
  Node's `require()` algorithm can still match. Whatever the precise
  mechanism, the result was reproduced twice (an isolated `tsc` invocation
  and the full `yarn workspace @cedarjs/testing build`) and held up under
  the full test suite, so `testing` needed no changes at all beyond what
  its own `yarn build` already does.

Verified all of it well beyond the unit test suites: a full local build of
the `test-project-rsc-kitchen-sink` fixture (via
`.github/actions/set-up-rsc-kitchen-sink-project`, the same harness CI
uses) — covering the Vite/RSC build pipeline, prerendering, and the `web`
bin proxies — completed cleanly twice (once before, once after the fix
round); direct regex tests against the built Jest preset confirming
`auth`/`router`/`web`/`forms` get transformed while other `@cedarjs/*`
packages stay ignored; running `@babel/preset-env` directly against the
real built `dist/index.js` of all three packages; and a full
`yarn build:clean` (`git clean -fdx` + reinstall + build from scratch) plus
`yarn lint`/`yarn nx run-many -t test`/`yarn test:types` at 0% Nx cache hit.

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
  would ripple out through every caller (Jest preset config building,
  `@babel/register`'s hook installation) — a real invasive change, not a
  mechanical one.

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
    through that combination of module settings. `packages/internal/src/ast.ts`
    (already ESM-only) hits the exact same `@babel/traverse` default-
    export ambiguity and already has the fix: unwrap with
    `const traverse = babelTraverse.default || babelTraverse`. Applied the same
    pattern here.
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

## Dual Mode -> ESM Only: Tier 3 (`api`, `graphql-server`, `storage`, `api-server`)

Converted the api-side Tier 3 batch scoped above, plus `api-server` (added to
the batch after the initial scoping — it turned out to have its own
`tsconfig.cjs.json` and heavy static value-imports of `project-config`/`api`,
the same TS1479-risk shape as `graphql-server`/`storage`, so it needed to
convert in lockstep with them anyway). `project-config` was also prototyped
in this batch and initially converted successfully, but was reverted at the
end — see the dedicated section below for why.

- **`api`**: mechanical `package.json`/`build.mts`/`tsconfig.cjs.json`
  conversion, plus a real fix: `src/bins/{cedar,cfw,redwood,tsc}.ts` (4
  files) each did a bare global `require.resolve(...)` — the exact same
  CJS-ism `web`'s 7 bin proxies had in the Tier 2 conversion, fixed the same
  way (`const require = createRequire(import.meta.url)` at the top of each
  file). `build.mts` also dropped the `src/bins/**` exclusion its ESM build
  pass used to carry (previously bins were CJS-only _specifically_ so they
  could use `require.resolve()`; once ESM has its own real `require`, the
  exclusion was no longer needed). `package.json`'s `bin` field moved from
  `dist/cjs/bins/*.js` to `dist/bins/*.js`. Verified by running the built
  `tsc.js`/`cedar.js`/`cfw.js`/`redwood.js` proxies directly with `node` —
  all resolve past the `createRequire` call cleanly (they only fail later,
  expectedly, when not run inside an actual Cedar project).
- **`graphql-server`**: the cleanest of the batch — already called
  `buildEsm()`/`buildCjs()` via the standard helpers, so the conversion was
  just dropping the CJS calls. Also cleaned up a dead legacy artifact found
  along the way: `__mocks__/@redwoodjs/paths.js`, a manual Jest-style mock
  keyed to the pre-rename `@redwoodjs/paths` package name. Confirmed dead
  (`@redwoodjs/paths` isn't a real dependency anywhere, nothing imports it,
  and the package's real `project-config` mocking happens via an inline
  `vi.mock('@cedarjs/project-config', ...)` in `makeMergedSchema.test.ts`)
  before deleting — and confirmed the _other_ file in that same
  `__mocks__/` directory, `@prisma/client.js`, is very much alive: Vitest
  (like Jest) auto-applies a `__mocks__/<package>.js` file adjacent to
  `node_modules` for real npm packages without needing an explicit
  `vi.mock()` call, unlike user-space modules. Almost deleted it by mistake
  along with the dead one — caught by checking for explicit `vi.mock()`
  call sites for each file individually rather than assuming a whole
  directory was dead.
- **`storage`**: mechanical conversion, same shape as `graphql-server`. Its
  `exports` map subpaths (`./FileSystemStorage`, `./MemoryStorage`, etc.)
  used bare `require`/`import` string-shorthand conditions rather than the
  nested `{types, default}` object shape the other packages in this doc
  use — collapsed to plain string paths (no more condition object needed at
  all once there's only one build).
- **`api-server`**: the biggest of the four. Already ESM-first in its build
  (unlike the others, its `build.mts` builds ESM before CJS), with its own
  `dirnameInjectorPlugin` esbuild plugin that rewrote `import.meta.dirname`
  to `__dirname` specifically for the CJS build — deleted entirely along
  with the CJS build passes, since the ESM output uses `import.meta.dirname`
  natively (the one real usage, in `serverManager.ts`, needed no change).
  No `require()`/`__dirname` anywhere in `api-server`'s own bin scripts
  (`bin.ts`, `watch.ts`, `logFormatter/bin.ts` — confirmed clean, so unlike
  `api`/`web` this package needed no `createRequire()` fixes there). The
  `package.json` `bin` field's 8 entries collapsed from a mix of
  `dist/cjs/*`/`dist/*` onto plain `dist/*` uniformly. An inline Vitest
  snapshot in `dist.test.ts` (`ships the expected bins`) had the old
  `dist/cjs/*` paths hardcoded — a real, expected test failure caught by
  the verification pass, fixed with `vitest run dist.test.ts -u`.

### The `api-server` CJS-forcing shim in `packages/cli`

The real substance of this batch, and not something the original Tier 3
scoping anticipated (it was found once `api-server` was added to the batch
and its consumers were checked): `packages/cli/src/commands/serve.ts` and
`serveBothHandler.ts` had a deliberate `projectIsEsm()`-gated branch that
force-loaded `api-server`'s CJS build via three CJS-only `exports` subpaths
(`./cjs/apiCliConfigHandler`, `./cjs/cliHelpers`, `./cjs/bothCliConfigHandler`
— these existed _only_ to be forced through, with no plain equivalent for
`bothCliConfigHandler`). `git log`/`gh pr view` on the introducing commit
showed the reason: `@cedarjs/cli` is ESM-only, so it always loads
`api-server`'s ESM build by default; but for a classic CommonJS-template
project, the user's own compiled api functions are loaded via `require()`.
At the time this shipped, `@cedarjs/context` (and, as of this batch,
`@cedarjs/api`/`@cedarjs/project-config`/`@cedarjs/graphql-server`) still had
_separate_ ESM and CJS builds — two distinct files, hence two distinct
in-memory module instances. For `@cedarjs/context` specifically, that meant
two different `AsyncLocalStorage` instances: one used by `api-server`'s own
(ESM) GraphQL/auth pipeline, and a different one used by the user's own
(CJS, `require()`'d) service code — silently breaking `context.currentUser`
propagation, since a value set via one `AsyncLocalStorage` instance is
invisible to code reading a different instance. Forcing `api-server`'s own
CJS build (which itself transitively `require()`'d the CJS builds of
`context`/`api`/`project-config`/`graphql-server` at the time) kept both
sides on the same instance.

With `api`, `graphql-server`, and `api-server` all converting to ESM-only in
this same batch (on top of `context` already being ESM-only since #2237),
this rationale mostly evaporates: a single-file package resolves to the
exact same module instance regardless of whether the loader used `require()`
(via Node 24's `require(esm)`) or `import()` — there's no second copy left
to diverge from. The three `.../cjs/*` exports subpaths (which only ever
existed to force this) were dropped from `api-server`'s `package.json`, a
new plain `./bothCliConfigHandler` subpath was added (mirroring
`./apiCliConfigHandler`/`./cliHelpers`, since `bothCliConfigHandler` had
previously only ever been exposed under its `/cjs/` path), and
`serve.ts`/`serveBothHandler.ts` were simplified to always call the plain
(now ESM-only) handlers, matching the pattern the `web` side already used
(`web-server` never needed this branching, since it only serves an
already-built `web/dist`, not the user's own live api code).

**One remaining, deliberately accepted gap**: `@cedarjs/project-config`
stayed dual-mode (see below), so a CJS-template project's api code that
`require()`s it directly (e.g. `api/src/lib/db.ts`, present in virtually
every generated project) resolves to a _different_ module instance of
`project-config` than `api-server`'s own ESM-loaded copy. This was checked
deliberately rather than assumed away: `project-config`'s only module-scope
state is memoization caches (`getPathsCache` in `paths.ts`,
`getConfigPathCache` in `configPath.ts`, `packageManagerCache` in
`packageManager.ts`, `configCache` in `prisma.ts`) keyed by deterministic
filesystem inputs — unlike `context`'s `AsyncLocalStorage`, having two
independent copies costs a little redundant computation, never produces a
wrong answer. Confirmed this is not a regression from before this batch by
running the CJS-template project's full api-side Jest suite end to end (see
"Empirical verification" below) — `requireAuth.test.ts` (which chains
through `auth.ts` -> `db.ts` -> `project-config`) and `context.test.ts` both
pass.

### The api-side Jest preset carve-out: `api`, `graphql-server`, `storage`

`@cedarjs/testing`'s own api entry point (imported by virtually every
generated project's api-side test, for scenario/mock helpers) does real
value-imports of the newly-ESM-only `@cedarjs/context` (already carved out
since #2237), `@cedarjs/graphql-server` (via `directive.ts`), and
`@cedarjs/api/webhooks` (via `apiFunction.ts`) — added both to the api-side
`transform`/`transformIgnorePatterns` carve-out in
`packages/testing/src/config/jest/api/jest-preset.ts`, mirroring the
`@cedarjs/context` entry added in #2237 and the equivalent web-side
mechanism.

`@cedarjs/storage` was added too, defensively: nothing in
`@cedarjs/testing/src` imports it (confirmed by grep), but the `cedar setup
uploads` codemod's `srcLibUploads.ts.template` does a real
`import { createUploadsConfig, setupStorage } from '@cedarjs/storage'` into
generated project code, which would hit the identical
"Cannot use import statement outside a module" failure the moment an
uploads-enabled project's api-side tests ran. Not exercised by
`local-testing-project` (it doesn't have uploads set up), so this one is
verified by code-reading the failure mode, not by a live repro — flagged
here in case a future uploads-focused smoke test turns up something this
reasoning missed.

**`@cedarjs/project-config` was _not_ added to this carve-out** — see below.

### Reverted: `project-config` stays dual mode

`project-config` was initially converted in this same batch (it's a
dependency-graph leaf, same shape as the others) and appeared to work: full
monorepo build, lint, and test suite all passed clean. It only broke once
verified against a _real_ generated CJS-template project's Jest suite (see
"Empirical verification" below for the `local-testing-project` tarball
workflow this used) — something the monorepo's own unit/integration tests
don't exercise, since nothing in this repo's own test suite runs the
api-side Jest preset against real generated project code.

Two distinct failures surfaced, in sequence:

1. **`project-config` needed the same Jest carve-out `api`/`graphql-server`
   got** — but for a different reason than those two. It's not imported by
   `@cedarjs/testing`'s own module graph at all (the static-analysis check
   that scoped the carve-out for the other three packages came back clean
   for `project-config`, correctly). What the analysis missed: the _user's
   own_ generated code imports it directly and unconditionally —
   `api/src/lib/db.ts`, present in virtually every generated project,
   does `import { getPaths } from '@cedarjs/project-config'`, and that file
   also goes through the same api-side Jest transform pipeline as
   `@cedarjs/testing`'s own code. This is a generalizable blind spot worth
   remembering for any future api-side ESM conversion: the carve-out
   analysis has to check not just `@cedarjs/testing`'s own source, but
   realistic generated-project code (default template _and_ common opt-in
   setup templates, which is also why `@cedarjs/storage` got added
   defensively above).
2. **After adding the carve-out, a second, unrelated failure appeared**:
   `project-config/src/prisma.ts`'s `loadPrismaConfig()` does
   `await import(pathToFileURL(prismaConfigPath).href)` to dynamically load
   the user's `prisma.config.cjs`/`.ts` file at a computed path. Real Node
   and Vitest handle this fine; Jest's module runtime does not — it
   intercepts dynamic `import()` calls, and (unlike its handling of a plain
   node*modules package specifier, which works, as proven by
   `getPrismaSchemas()`'s `await import('@prisma/internals')` succeeding
   right next to the failing call) can't resolve a `file://` URL pointing
   at an arbitrary on-disk file. This is, in fact, exactly the problem
   `project-config`'s \_old* CJS build worked around at the build level: a
   string-replacement step in `build.ts` rewrote `await import(configUrl)`
   to `require(prismaConfigPath)` in the built `dist/cjs/index.js`,
   specifically because "this file will be consumed by Jest, and jest
   doesn't support that syntax" (verbatim comment, tagged
   `TODO: Remove this once we go ESM-only`) — the workaround assumed that
   going ESM-only would make the problem disappear, but it resurfaces in a
   new form once the _only_ build is the one Jest has to consume directly.

   The fix that was tried: `createRequire()`-based synchronous `require()`
   inside `loadPrismaConfig()` itself (bypassing Jest's `import()`
   interception the same way `createRequire()` bypasses Jest's `require()`
   interception elsewhere in this doc). The first attempt used
   `createRequire(import.meta.url)` at module scope — which then hit a
   _third_, narrower failure: the api-side carve-out's babel-jest transform
   (`@babel/preset-env` only, no additional plugins) rewrites `import`/
   `export` to CommonJS but doesn't touch `import.meta` syntax at all,
   producing `Cannot use 'import.meta' outside a module` once Jest tried to
   execute the transformed CommonJS output. Fixed by using
   `createRequire(prismaConfigPath)` instead (the target path is already
   absolute, so it works fine as `createRequire`'s base) rather than
   `createRequire(import.meta.url)`, sidestepping `import.meta` entirely.

   This second fix worked — verified via the same real CJS-template project
   Jest suite, all real tests passing (`requireAuth.test.ts`,
   `context.test.ts`, `users.test.ts`, `posts.test.ts`, etc.) — but was
   **reverted anyway**, per explicit user feedback: putting Jest-runtime-
   specific reasoning and workarounds into `project-config`'s own shared
   source (a comment explaining Jest's `import()` limitations, sitting in a
   function every consumer — CLI, api-server, generated projects — calls)
   was judged not worth it just to drop one package's CJS build, when the
   framework already has a designated, correct place for Jest-specific
   workarounds: the Jest preset itself. `project-config` was fully reverted
   (`package.json`, `build.ts`, `tsconfig.cjs.json`, `src/prisma.ts` all
   back to their pre-batch state via `git checkout HEAD --`), and the
   `project-config` carve-out entry was removed from the Jest preset since
   it's no longer needed — Jest can `require()` project-config's real CJS
   build directly again, same as before this batch.

   This is a case where the same technique used successfully elsewhere in
   this doc (`createRequire()` to route around a runtime's inability to
   handle real ESM synchronously — see `babel-config`, the `web`/`api` bin
   proxies, `cedar-jobs`) was technically sound but stylistically
   undesirable for _this_ call site specifically, because the workaround
   would have lived in core framework source rather than in test
   infrastructure. Worth keeping in mind for future conversions: a working
   `createRequire()` fix is not automatically the right call if a
   Jest-preset-level carve-out (or accepting a package stays dual mode) is
   available instead and the source-level change would otherwise be purely
   about accommodating Jest.

`packages/testing`'s api-side Jest preset carve-out (`api`, `graphql-server`,
`storage`) and the `api-server`/`cli` shim removal were both kept — neither
required any Jest-specific reasoning inside non-test-infrastructure source,
and both were independently verified against the real CJS-template project's
Jest suite after the `project-config` revert, still passing.

### Empirical verification

Beyond the monorepo's own `yarn build:clean` (0% Nx cache) / `yarn lint` /
`yarn nx run-many -t test --skip-nx-cache` / `yarn test:types`, this batch
was verified against real generated projects using the `yarn build:pack` +
tarball-`yarn install` workflow against `local-testing-project`/
`local-testing-project-live` described in "Development Workflow" in
`CLAUDE.md`:

- A synthetic identity check (`require()` a package's built `dist/index.js`
  via `createRequire` alongside a real `import()` of the same file, from a
  throwaway `.cjs`/`.mjs` pair) confirmed `@cedarjs/context`'s
  `getAsyncStoreInstance()` returns the exact same `AsyncLocalStorage`
  across both loading styles once a package is single-file — the concrete
  mechanism behind why the `api-server` CJS-forcing shim removal is safe,
  demonstrated directly rather than just argued from module-resolution
  theory.
- `api`'s bin proxies (`tsc.js`, `cedar.js`, `cfw.js`, `redwood.js`) were run
  directly with `node` from the built `dist/bins/`, confirming the
  `createRequire(import.meta.url)` fix resolves cleanly before failing
  later (expectedly) for not being run inside a real project.
- `local-testing-project` (the classic CommonJS-template fixture) had its
  tarballs refreshed and its full api-side Jest suite run for real,
  including `requireAuth.test.ts` and `context.test.ts` — this is what
  caught both `project-config` failures above; the monorepo's own test
  suite has no equivalent coverage since it never runs the api-side Jest
  preset against real generated-project code. Running this suite triggers
  the api-side Jest preset's `globalSetup`, which runs
  `prisma db push --force-reset` against the fixture's local SQLite test
  database — Prisma's own safety tooling flags this as a destructive
  action needing explicit user confirmation before an AI agent proceeds;
  got that confirmation before running it (the database is a throwaway
  local dev/test file used only by this repo's manual smoke-testing setup,
  not anything resembling production).
- `local-testing-project-live` (the ESM-template fixture) was checked
  structurally (its `prisma.config.cjs` requires a real PostgreSQL
  `DIRECT_DATABASE_URL`, not available locally, so its test suite wasn't
  run end-to-end) — but this fixture's code path through `api-server`/`cli`
  was already provably identical before and after this batch: the removed
  `projectIsEsm()` branch's `else` arm (the one ESM-template projects
  always took) called the exact same plain handlers that are now called
  unconditionally, so there was no new behavior to verify there.
- All tarball-testing lockfile/config churn in `local-testing-project`,
  `local-testing-project-live`, and the repo-root `yarn.lock` (beyond the
  legitimate `bin` field path changes) was reverted before finishing, per
  the established workflow note that this churn shouldn't be committed.
