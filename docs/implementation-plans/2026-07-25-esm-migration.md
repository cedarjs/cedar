Here's the breakdown of the 74 packages in the CedarJS monorepo:

CJS Only (0)

- None — all 27 originally-CJS-only packages have now been converted to
  ESM-only (see below).

ESM Only (51)

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
- auth-auth0-web
- auth-azure-active-directory-web
- auth-clerk-web
- auth-dbauth-web
- auth-dbauth-middleware
- auth-firebase-web
- auth-netlify-web
- auth-supabase-web
- auth-supabase-middleware
- auth-supertokens-web

Dual Mode – CJS + ESM (23)

- api
- api-server
- auth
- babel-config
- cli-helpers
- context
- cookie-jar
- eslint-config
- forms
- gqlorm
- graphql-server
- internal
- jobs
- ogimage-gen
- prerender
- project-config
- record
- router
- server-store
- storage
- testing
- vite
- web

Summary: Of the 74 packages, 23 are dual mode (CJS + ESM), 0 are CJS-only, and
51 are ESM-only. Every package that was CJS-only as of the original inventory
below has now been converted to ESM-only, and the 10 `auth-*-web` /
`auth-*-middleware` packages that used to be Dual Mode have also been
converted to ESM-only (see "Dual Mode -> ESM Only" below) — they were dual
mode from a mechanical Babel-to-esbuild tooling migration, not because
anything actually needed a CJS build of them. ESM-only remains the packages
that have been explicitly converted to drop their CJS build entirely;
`eslint-plugin`, `telemetry`, `tui`, `web-server`, the 7 `mailer/*` packages,
the 17 `auth-*-api`/`auth-*-setup` packages,
`fastify-web`/`cli-data-migrate`/`cli-storybook-vite`, and the 10
`auth-*-web`/`auth-*-middleware` packages are the conversions done so far.

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
