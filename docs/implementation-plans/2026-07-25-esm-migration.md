Here's the breakdown of the 74 packages in the CedarJS monorepo:

CJS Only (17)

- auth-auth0-api
- auth-auth0-setup
- auth-azure-active-directory-api
- auth-azure-active-directory-setup
- auth-clerk-api
- auth-clerk-setup
- auth-custom-setup
- auth-dbauth-api
- auth-dbauth-setup
- auth-firebase-api
- auth-firebase-setup
- auth-netlify-api
- auth-netlify-setup
- auth-supabase-api
- auth-supabase-setup
- auth-supertokens-api
- auth-supertokens-setup

ESM Only (24)

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
- fastify-web (adapters/fastify/web)
- cli-data-migrate
- cli-storybook-vite

Dual Mode – CJS + ESM (33)

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

Summary: Of the 74 packages, 33 are dual mode (CJS + ESM), 17 are CJS-only, and
24 are ESM-only. The CJS-only group is now just the 17 `auth-providers/*`
`api`/`setup` sub-packages (the `mailer/*` sub-packages, `fastify-web`, and the
`cli-data-migrate`/`cli-storybook-vite` CLI packages have all since been
converted). All of these still-CJS packages build with esbuild's default `cjs`
format and never emit an ESM output. The `*-web` and `*-middleware`
auth-provider packages, by contrast, build both ESM and CJS (via
`buildEsm`/`buildCjs` or `buildExternalEsm`/`buildExternalCjs`) and so land in
Dual Mode alongside the already-tracked framework packages. ESM-only remains the
packages that have been explicitly converted to drop their CJS build entirely;
`eslint-plugin`, `telemetry`, `tui`, `web-server`, the 7 `mailer/*` packages,
and `fastify-web`/`cli-data-migrate`/`cli-storybook-vite` are the conversions
done so far (see the sequencing plan below).

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
  `import`, never `require()`. Safe, essentially risk-free. **Done**
  (this PR).
- **`cli-data-migrate`, `cli-storybook-vite`**: loaded by the CLI via
  `await import(packageName)` (dynamic ESM import) in
  `packages/cli/src/lib/plugin.ts`, not `require()`. Safe, risk-free.
  **Done** (this PR).
- **`auth-*-api` / `auth-*-setup`** (17 packages): pulled into generated user
  apps. The non-ESM ("commonjs") templates transpile the user's `import`
  statements to `require()` via Babel at build time, so this is the one place a
  real cross-boundary `require()` of these packages happens today. Under Node 24
  that now resolves via `require(esm)` instead of throwing `ERR_REQUIRE_ESM`.
  Safe given the Node 24 floor, but end-user-facing — worth a smoke test against
  a generated commonjs-template project before converting.

**Conclusion**: all 27 originally-CJS-only packages are viable candidates for
conversion to ESM-only. Suggested sequencing, low-risk first:

1. `mailer-core`, `mailer-handler-in-memory`, `mailer-handler-nodemailer`,
   `mailer-handler-resend`, `mailer-handler-studio`,
   `mailer-renderer-mjml-react`, `mailer-renderer-react-email` — no real
   external `require()` callers found at all. **Done** (PRs #2211, #2212,
   #2215-#2219).
2. The 17 `auth-*-api` / `auth-*-setup` packages — mechanically identical
   conversion, batch together, smoke-test against a generated commonjs template
   project. **Done**, batched into a single PR (#2223).
3. `fastify-web`, `cli-data-migrate`, `cli-storybook-vite` — no real external
   `require()` callers found at all. **Done** (this PR).
