Here's the breakdown of the 76 packages in the CedarJS monorepo:

CJS Only (29)

- fastify-web (adapters/fastify/web)
- cli-data-migrate
- cli-storybook-vite
- mailer-core
- mailer-handler-in-memory
- mailer-handler-nodemailer
- mailer-handler-resend
- mailer-handler-studio
- mailer-renderer-mjml-react
- mailer-renderer-react-email
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
- cedarjs-jest-api-preset (testing/config/jest/api)
- cedarjs-jest-web-preset (testing/config/jest/web)

ESM Only (17)

- cli
- cli-helpers
- codemods
- context
- core
- create-cedar-app
- create-cedar-rsc-app
- framework-tools
- realtime
- record
- storybook
- structure
- utils
- eslint-plugin (https://github.com/cedarjs/cedar/pull/2206)
- telemetry (https://github.com/cedarjs/cedar/pull/2204)
- tui (https://github.com/cedarjs/cedar/pull/2205)
- web-server (https://github.com/cedarjs/cedar/pull/2207)

Dual Mode – CJS + ESM (30)

- api
- api-server
- auth
- babel-config
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

Summary: Of the 76 packages, 30 are dual mode (CJS + ESM), 29 are CJS-only, and
17 are ESM-only. The CJS-only group is dominated by the `auth-providers/*`
`api`/`setup` sub-packages and the `mailer/*` sub-packages, which all build with
esbuild's default `cjs` format and never emit an ESM output. The `*-web` and
`*-middleware` auth-provider packages, by contrast, build both ESM and CJS (via
`buildEsm`/`buildCjs` or `buildExternalEsm`/`buildExternalCjs`) and so land in
Dual Mode alongside the already-tracked framework packages. ESM-only remains the
packages that have been explicitly converted to drop their CJS build entirely,
with `eslint-plugin`, `telemetry`, `tui`, and `web-server` being the most recent
conversions.

## CJS Only -> ESM Only: candidates given the Node 24 requirement

CedarJS has a hard requirement on Node 24 (`node: "=24.x"` in the generated
project templates, `node: ">=24"` in `create-cedar-app`), which has unflagged
support for `require(esm)` — a CJS `require()` call can now synchronously load a
real ESM module, as long as that module (and its transitive graph) has no
top-level `await`. This removes the original reason most of the 29 CJS-only
packages were left CJS-only: they didn't need a parallel CJS build because
nothing was actually blocked from `require()`-ing an ESM build anymore.

Checking actual consumers of the 29 CJS-only packages across the monorepo and
generated templates:

- **`mailer-core`, `mailer-handler-*`, `mailer-renderer-*`**: the only
  `require()` calls found anywhere are two lazy, try/catch-wrapped lookups in
  `packages/mailer/core/src/mailer.ts` (feature-detecting the optional
  `mailer-handler-in-memory` and `mailer-handler-studio` packages). Neither
  handler module has top-level `await`. Safe to convert.
- **`fastify-web`**: every consumer (`api-server`, `web-server`) already uses
  `import`, never `require()`. Safe, essentially risk-free.
- **`cli-data-migrate`, `cli-storybook-vite`**: loaded by the CLI via
  `await import(packageName)` (dynamic ESM import) in
  `packages/cli/src/lib/plugin.ts`, not `require()`. Safe, risk-free.
- **`auth-*-api` / `auth-*-setup`** (17 packages): pulled into generated user
  apps. The non-ESM ("commonjs") templates transpile the user's `import`
  statements to `require()` via Babel at build time, so this is the one place a
  real cross-boundary `require()` of these packages happens today. Under Node 24
  that now resolves via `require(esm)` instead of throwing `ERR_REQUIRE_ESM`.
  Safe given the Node 24 floor, but end-user-facing — worth a smoke test against
  a generated commonjs-template project before converting.
- **`cedarjs-jest-api-preset`, `cedarjs-jest-web-preset`**: read by Jest's own
  `preset` resolution in generated projects' `jest.config.js`. Jest's
  config/preset loader (`requireOrImportModule`) already tries `require()` first
  and only falls back to `import()` on `ERR_REQUIRE_ESM`, so this should also
  just work — but it's the most indirect path (goes through Jest's own module
  loader, version-dependent), so verify concretely against the actual pinned
  Jest version before shipping.

**Conclusion**: all 29 CJS-only packages are viable candidates for conversion to
ESM-only. Suggested sequencing, low-risk first:

1. `mailer-core`, `mailer-handler-in-memory`, `mailer-handler-nodemailer`,
   `mailer-handler-resend`, `mailer-handler-studio`,
   `mailer-renderer-mjml-react`, `mailer-renderer-react-email`, `fastify-web`,
   `cli-data-migrate`, `cli-storybook-vite` — no real external `require()`
   callers found at all.
2. The 17 `auth-*-api` / `auth-*-setup` packages — mechanically identical
   conversion, batch together, smoke-test against a generated commonjs template
   project.
3. `cedarjs-jest-api-preset`, `cedarjs-jest-web-preset` — convert last, verify
   with an actual `jest` run in a generated project.
