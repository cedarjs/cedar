## Highlights

### Fragment Cells

Cells can now declare their data requirements with a `FRAGMENT` export instead
of firing a query of their own. A parent Cell spreads the fragment in its
`QUERY` and passes the matching slice of the query result down as a prop named
after the fragment, so nested Cells no longer create request waterfalls — one
single GraphQL request fetches everything.

```tsx
// AuthorCell.tsx
export const FRAGMENT = gql`
  fragment AuthorCell_author on User {
    id
    email
    fullName
  }
`

export const Success = ({ author }) => <span>{author.fullName}</span>
```

```tsx
// BlogPostCell.tsx
export const QUERY = gql`
  query FindBlogPostQuery($id: Int!) {
    post(id: $id) {
      id
      title
      author {
        ...AuthorCell_author
      }
    }
  }
`

export const Success = ({ post }) => (
  <article>
    <h2>{post.title}</h2>
    <AuthorCell author={post.author} />
  </article>
)
```

Fragment Cells automatically register their fragment with the GraphQL client,
so spreading it by name is enough — no imports or interpolation needed. When
the fragment selects the type's `id`, the Cell reads its data live from the
Apollo cache and re-renders when mutations update the entity. See the new
"Fragment Cells: Aggregating Queries" section in the Cells docs.

### New `cell-type-annotations` ESLint rule

`@cedarjs/eslint-plugin` has a new `cell-type-annotations` rule, mirroring the
existing `service-type-annotations` rule but for Cells. It flags Cell exports
(`beforeQuery`, `afterQuery`, `isEmpty`, `Loading`, `Failure`, `Success`) that
are missing type annotations, and autofixes most of them using the types from
`@cedarjs/web` (`CellBeforeQueryResult`, `DataObject`, `CellLoadingProps`,
`CellFailureProps`, `CellSuccessProps`). `beforeQuery`'s parameter type is
flagged but never autofixed — Cedar can't safely guess your props shape — but
it's worth annotating by hand, since it drives Cedar's prop-type inference for
the rest of the Cell.

Like `service-type-annotations`, it's off by default. Enable it in your
project's `eslint.config.mjs`:

```js
import cedarConfig from '@cedarjs/eslint-config'

export default [
  ...(await cedarConfig()),
  {
    files: ['web/src/components/**/*Cell.tsx'],
    rules: {
      '@cedarjs/cell-type-annotations': 'error',
    },
  },
]
```

### `configureGraphQLServer` and `configureServer` options for the API server

`createServer()` gains two new configuration hooks alongside the existing
`configureApiServer`: `configureGraphQLServer`, scoped to just the GraphQL
route, and `configureServer`, which runs on the root Fastify instance
_before_ either the api functions or the GraphQL plugin register their
routes — the right place for plugins with a "global" registration mode (like
`@fastify/compress`) that only affect routes registered after them:

```js
const server = await createServer({
  configureServer: (server) => {
    server.register(compress, { global: true })
  },
})
```

This also fixes a bug where registering something like `@fastify/compress`
through `configureApiServer` alone only compressed api-function responses,
never GraphQL responses — the two are separate Fastify encapsulation
contexts.

### Background jobs: enforced timeouts and cancellation

A job that runs past `maxRuntime` is now permanently failed by the worker
that was running it — recorded as a `JobTimeoutError` in `lastError` — instead
of silently staying eligible for another worker to pick up and re-run
concurrently (with the default `deleteFailedJobs: false`; if you've set that
to `true`, the job row is deleted instead of retained with the error). This
closes the common case, not every case: a worker that crashes outright,
rather than hitting the timeout, still leaves its job reclaimable by another
worker once `maxRuntime` plus a short grace period elapses. Jobs can opt into
cooperative cancellation via the new `getJobExecutionContext()`:

```ts
import { getJobExecutionContext } from '@cedarjs/jobs'

perform: async () => {
  const context = getJobExecutionContext()
  await fetch(url, { signal: context?.signal })
}
```

Queued or running jobs can also be cancelled directly (shown here with the
default `PrismaAdapter`, whose `schedule()` returns the job record — see the
adapter note below if you use a custom one):

```ts
const scheduledJob = await later(SampleJob, [args])
await later.cancel(scheduledJob.id)
```

If you have a custom job adapter: `later()`/`Scheduler.schedule()` used to
always resolve to `true`; it now resolves to whatever your adapter's
`schedule()` returns. `PrismaAdapter` returns the created job record (still
truthy), but a custom adapter whose `schedule()` returns nothing will now
see `undefined` from `later()` instead of `true`.

### More Redwood → Cedar renaming

Continuing the move from Redwood to Cedar naming, several more public APIs
now have Cedar-named counterparts. The Redwood-named originals keep working
as deprecated aliases — nothing breaks — but update to the new names when
convenient, since the old ones will be removed in a future release:

- `RedwoodApolloProvider` → `CedarApolloProvider`, now imported from a
  dedicated subpath:

  ```tsx
  import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'
  ```

- `RedwoodProvider` → `CedarProvider` (`@cedarjs/web`)
- The GraphQL Yoga plugins in `@cedarjs/graphql-server` — `useRedwoodDirective`,
  `useRedwoodAuthContext`, `useRedwoodError`, `useRedwoodGlobalContextSetter`,
  `useRedwoodLogger`, `useRedwoodPopulateContext`, `useRedwoodOpenTelemetry`,
  and `useRedwoodTrustedDocuments` — and their supporting types now have
  `useCedar*`/`Cedar*` equivalents
- `RedwoodError` and `RedwoodLoggerOptions` in `@cedarjs/api` are now
  `CedarError` and `CedarLoggerOptions`

Update `web/src/App.tsx` and any custom GraphQL server config to the new
names when convenient.

### A Vite-native build pipeline

Cedar's custom Babel plugins have been ported to native Vite plugins for
projects on the Vite-based pipeline: directory-named imports, GraphQL options
extraction, gql tag handling, mock Cell data, OpenTelemetry wrapping, job path
injection, and the `src/`/`$api/`/tsconfig-paths aliases. Transforms that Vite
already handles natively are no longer duplicated through Babel. Unless you
enable the React Compiler, Babel is now entirely out of the web build — faster
transforms, correct sourcemaps, and fewer configuration edge cases. (See the
breaking `web/babel.config.js` change below if you have a custom Babel setup.)

### Deploy: standard container-host conventions

Several changes together let a generated Cedar app deploy to a container
host (Railway, Render, Fly.io, Google Cloud Run, Coolify, Dokku, Dokploy,
Koyeb, Northflank, and similar) with little to no platform-specific
configuration:

- Generated apps now ship `build`/`dev`/`start`/`start:api`/`start:web`
  scripts in their root `package.json`, so zero-config builders that detect
  a `start` script (and run `build` first) — Railpack, Nixpacks, Paketo,
  Google Cloud buildpacks — can boot a Cedar app with no Dockerfile or config
  file. Heroku and DigitalOcean App Platform prune `devDependencies` before
  running `start` by default, which breaks this unless you disable pruning
  (`NPM_CONFIG_PRODUCTION=false` / `YARN_PRODUCTION=false` on Heroku,
  `YARN2_SKIP_PRUNING=true` / `NPM_CONFIG_PRODUCTION=false` on DigitalOcean).
- `cedar serve` and `cedar serve api` now read the `PORT`/`HOST` environment
  variables every container PaaS sets, instead of requiring an explicit
  `--port`/`--host`. See the breaking change below for the one existing
  behavior this changes.
- `yarn cedar setup database postgres` converts a project from SQLite to
  Postgres — schema, Prisma adapter, config — without also provisioning a
  Neon database. Previously that conversion was only reachable through
  `setup neon`, which coupled it to one specific provider; `setup neon` now
  builds on top of this new, provider-agnostic command.
- `create-cedar-app` no longer bundles a lockfile in the base template —
  each package-manager overlay (yarn/npm/pnpm) generates and ships its own,
  so a new project never ends up with two conflicting lockfiles.

### `request` in getCurrentUser and authDecoder

On fetch-native code paths (the unified dev server and GraphQL Yoga),
`getCurrentUser()` and custom `authDecoder` functions now receive the native
web `Request` as a new optional `request` property, alongside the Lambda-shaped
`event` they always got. `event` keeps working everywhere it used to — but
prefer `request.headers.get('...')` over `event.headers['...']` where
`request` is available.

### CLI improvements

- `yarn cedar dev --node-args="…"` forwards Node CLI args to the dev server
  process. This enables `--inspect` debugging, `--max-old-space-size`, and V8
  flags like `--no-maglev` (which works around a V8 crash on Windows).
- `yarn cedar dev --ud` now pretty-prints api-side logs instead of dumping raw
  JSON log lines.
- Data migrations in ESM projects now run through Vite, so migration scripts
  get the same import aliases and plugin behavior as the rest of your api
  side.
- Background job workers now run in-process under Unified Dev
  (`yarn cedar dev --ud`), through the same Vite server that serves
  `api/src`, instead of requiring a separate `cedar-jobs work` process
  against a manually built `api/dist`.
- Projects located in filesystem paths containing spaces now work correctly.
- API functions returning status 204, 205, or 304 no longer crash under the
  fetch-native runtime.

### Better DX for AI coding agents

A batch of fixes came out of watching an AI coding agent build a Cedar app
end-to-end and tracking down every place it got stuck or produced insecure
code:

- **`PrivateSet` is easier to find.** It's now an explicit named export from
  `@cedarjs/router` instead of hiding behind a wildcard re-export, and its
  doc comment calls out the `RequireAuth`/`ProtectedRoute` names other
  routers use for the same concept.
- **The scaffold generator teaches route protection.** When a project has
  auth set up and a `login` route exists, `yarn cedar generate scaffold`
  now wraps the generated routes in `<PrivateSet unauthenticated="login">`
  automatically, so `PrivateSet` shows up in the first generated code most
  developers see.
- **dbAuth setup notes mention `PrivateSet`.** `yarn cedar setup auth dbAuth`
  now prints a short snippet showing how to protect a route right after
  auth is wired up.
- **`cedar check` warns about unprotected auth-gated mutations.** If a route
  isn't wrapped in `<PrivateSet>`/`<Private>` but its page transitively
  calls a mutation marked `@requireAuth` in the SDL, `cedar check` now flags
  it. This also fixed `isPrivate`/`unauthenticated`/`roles` to look past the
  immediate JSX parent, so routes nested inside `<PrivateSet><Set>...` are
  now correctly recognized as protected.
- **`cedar test` fails fast on a database mismatch.** Instead of hanging
  indefinitely, it now checks that `TEST_DATABASE_URL` matches the provider
  configured in `schema.prisma` and throws an actionable, credential-redacted
  error before Prisma is invoked.
- **`cedar generate sdl` and `cedar generate scaffold` are relation-aware and
  redact sensitive fields.** Generating SDL (or scaffolding) a model with a
  relation to a model that has no SDL yet now generates read-only stubs for
  those related models instead of leaving the project in a broken state with
  a failing type-generation step — run `cedar generate sdl <Model>` later to
  replace a stub with the real thing. dbAuth's sensitive fields
  (`hashedPassword`, `salt`, `resetToken`, and friends) are also excluded by
  name from generated SDL, inputs, scaffolds, and service tests, so they're
  no longer queryable or settable through the GraphQL API by default.
- **`cedar dev --fwd` actually forwards args now.** Dev server options like
  `--port` and `--open` passed through `--fwd` used to be silently dropped;
  the flag is also no longer hidden. `cedar dev` also now defaults to
  `open: false` when there's no interactive TTY (CI, AI agents), regardless
  of `[browser] open` in `cedar.toml`.
- **The new `cell-type-annotations` ESLint rule catches untyped Cells.**
  Cells generated (or hand-edited) without their `beforeQuery`/`afterQuery`/
  `isEmpty` and `Loading`/`Failure`/`Success` type annotations now get flagged
  and mostly autofixed. See the Highlights section above for how to enable it.

### `postcss-loader` is no longer installed

`yarn cedar setup ui tailwindcss` used to install `postcss-loader` alongside
`postcss`, `tailwindcss` and `autoprefixer`. It's a webpack loader left over
from before the move to Vite, and does nothing in a Vite build.

If you set up Tailwind with an older version of Cedar (or with Redwood), it's
still in your `web/package.json` and you can safely remove it:

```shell
yarn workspace web remove postcss-loader
```

### `dns.setDefaultResultOrder` is gone from the app template

New projects' `web/vite.config.{js,ts}` no longer starts with this:

```js
import dns from 'node:dns'

// So that Vite will load on localhost instead of `127.0.0.1`.
// See: https://vitejs.dev/config/server-options.html#server-host.
dns.setDefaultResultOrder('verbatim')
```

It's a workaround for Node versions that reordered DNS lookup results. Node
has defaulted to `verbatim` since v17, so on Node 24 — the version Cedar
requires — the call does nothing.

If your project was generated by an older version of Cedar (or by Redwood),
those lines are still in your `web/vite.config.{js,ts}`. Nothing breaks if you
keep them, but you can delete the `dns` import, the comment, and the call.

## Breaking changes

- **[No more CJS-only packages](#no-more-cjs-only-packages)** — standard apps are unaffected; only breaks projects that compile their own TypeScript straight to CommonJS with `tsc` and statically import `@cedarjs/*` packages directly.
- **[`cedar serve api --ud` binds to all interfaces by default](#cedar-serve-api---ud-binds-to-all-interfaces-by-default)** — its default host changed from `localhost` to `::`/`0.0.0.0`, matching every other `serve` path.
- **[Vitest 4 (ESM projects)](#vitest-4-esm-projects)** — needs a `vite@7.3.6` pin, and your own tests may hit a few Vitest 4 API changes.
- **[MSW 2](#msw-2)** — breaks tests/stories that import `msw`/`whatwg-fetch` directly, override the Jest preset's `testEnvironment`/`transformIgnorePatterns`, or have an old committed `mockServiceWorker.js`; most apps need no changes.
- **[`web/babel.config.js` is no longer used by Vite](#webbabelconfigjs-is-no-longer-used-by-vite)** — custom Babel plugins/presets there stop running in the web build unless passed via the new `babel` Vite plugin option.
- **[GraphQL client-agnostic indirection removed](#graphql-client-agnostic-indirection-removed)** — `GraphQLHooksProvider` and a handful of ambient GraphQL types are gone; switch to Apollo directly.
- **[`yarn cedar console` removed](#yarn-cedar-console-removed)** — moved to a standalone package, run with `yarn dlx @cedarjs/console` instead.
- **[Custom generator templates path removed](#custom-generator-templates-path-removed)** — move `api/generators/`/`web/generators/` templates to `generatorTemplates/` (a codemod does this for you).
- **[`getCommonPlugins()` removed](#getcommonplugins-removed)** — delete any `...getCommonPlugins()` usage; it's returned an empty array for a long time.
- **[Web dev server `Buffer` polyfill removed](#web-dev-server-buffer-polyfill-removed)** — web code relying on the global `Buffer` in dev now fails immediately instead of only in production.
- **[Context-wrapping plugin renamed](#context-wrapping-plugin-renamed)** — only affects advanced setups that reference the AsyncLocalStorage-wrapping plugin by name.
- **[Apollo Client 4](#apollo-client-4)** — app code that imports from `@apollo/client` directly needs updating; Cells and `@cedarjs/web`'s re-exported hooks keep working unchanged.

### No more CJS-only packages

Every `@cedarjs/*` package that used to be CommonJS-only or dual-mode
(CJS+ESM) has moved to ESM-only, except `@cedarjs/prerender`,
`@cedarjs/testing`, and `@cedarjs/project-config`, which stay dual-mode for
now — no package in the framework is CommonJS-only anymore. See the
[ESM migration plan](https://github.com/cedarjs/cedar/blob/main/docs/implementation-plans/2026-07-25-esm-migration.md)
for the full package-by-package rationale.

**For a standard generated Cedar app — CJS or ESM template — this is not
breaking.** Framework code is always reached either through a plain `import`
(bundled by Vite/Rollup) or, for API-side CJS-template projects, through
Babel-transpiled `require()` calls, and Node 24 (Cedar's minimum supported
version) transparently handles `require()`-ing an ESM module via its
`require(esm)` support. No action is needed if you import these packages the
standard way, through the generated templates.

**It is breaking if you compile your own TypeScript straight to CommonJS
with `tsc`** (not Babel) and statically `import` a `@cedarjs/*` package —
for example, a custom auth integration built directly against
`@cedarjs/auth-*-api`. `tsc` refuses to emit a static `require()` for a
module it resolves as ESM-only (`TS1479`/`TS1541`), even though Node can
handle it at runtime, so the build fails. If you hit this:

- Switch the value import to a dynamic `import()`.
- For type-only imports, add a `resolution-mode: 'import'` attribute:

  ```ts
  import type { Foo } from '@cedarjs/some-package' with {
    'resolution-mode': 'import',
  }
  ```

### `cedar serve api --ud` binds to all interfaces by default

`cedar serve api --ud` used to read `process.env.PORT` directly and bind to
`localhost`. It now goes through the same host/port resolution as every
other `serve` path, which means its _default_ host changes from `localhost`
to `::` in dev / `0.0.0.0` in production — matching `cedar serve`/
`cedar serve api` elsewhere. If you relied on the api side only being
reachable from localhost under `--ud`, pass `--host localhost` explicitly.
(This is a separate command from `cedar dev --ud`, which handles api routes
in-process through the Vite dev server and isn't affected.)

Separately, a backwards-compatible environment-variable change now reads
`PORT`/`HOST` automatically on whichever side is publicly reachable (web,
when both sides are served together; api, when served alone) — the other
side ignores them entirely and keeps using its configured host/port.
Resolution order, highest priority first: CLI flags, then `CEDAR_API_PORT`/
`CEDAR_WEB_PORT`/`CEDAR_API_HOST`/`CEDAR_WEB_HOST` (non-empty values override
the deprecated `REDWOOD_*` aliases, which still work as silent fallbacks),
then `PORT`/`HOST` on the public side only, then `[api].port`/`[web].port`
in `cedar.toml`, then the built-in default.

### Vitest 4 (ESM projects)

ESM projects run their tests with Vitest, which Cedar has upgraded from v3 to
v4. After upgrading Cedar:

1. Bump `vitest` to `4.1.10` in your root `package.json`.
2. Make sure Vite is pinned to the version Cedar uses — without a pin,
   Vitest 4 pulls in its own copy of Vite 8 and web tests fail to parse JSX.
   The syntax depends on your package manager.

   yarn — in your root `package.json`:

   ```json
   "resolutions": {
     "vite": "7.3.6"
   }
   ```

   npm — in your root `package.json`:

   ```json
   "overrides": {
     "vite": "7.3.6"
   }
   ```

   pnpm — in your `pnpm-workspace.yaml`:

   ```yaml
   overrides:
     vite: '7.3.6'
   ```

Cedar's generated `vitest.config.ts` files are already Vitest 4 compatible.
Your own tests and config customizations may hit some of Vitest 4's breaking
changes, most commonly:

- The config options `poolOptions`, `minWorkers`, `maxThreads`, and
  `minThreads` were removed, and `workspace` was renamed to `projects`.
- `vi.fn(() => obj)` called with `new` now throws — use
  `vi.fn(function () { return obj })` or a class.
- `vi.spyOn()` on an already-spied method returns the existing spy, so call
  counts can leak between tests unless you clear them.
- `vi.restoreAllMocks()` (and the `restoreMocks` config option) now only
  restores `vi.spyOn` spies, not `vi.fn()` mocks.
- `beforeAll`/`afterAll` hooks now receive `(context, suite)` instead of the
  suite as the first argument.
- Obsolete snapshots now fail test runs instead of being reported.

See the Vitest migration guide for the full list:
https://vitest.dev/guide/migration

### MSW 2

`@cedarjs/testing` now uses MSW 2 internally (up from MSW 1). Cedar's mocking
API is unchanged: `mockGraphQLQuery`, `mockGraphQLMutation`, `mockCurrentUser`,
and Cell `*.mock.ts` files keep working as before, including the
`(variables, { ctx, req })` data-function signature. Most apps need no changes.

This release also starts MSW for ESM/Vitest web-side tests for the first
time — previously, GraphQL requests in those tests silently went out
unmocked instead of being intercepted. Existing apps pick this up
automatically on upgrade, with no changes needed to `web/vitest.setup.ts`.

You do need to act if you:

- **Import from `msw` directly** in tests or stories. MSW 2 is a rewrite of
  the handler API: `rest` is now `http`, resolvers return an `HttpResponse`
  instead of calling `res(ctx....)`, and `setupWorker` moved to
  `msw/browser`. See https://mswjs.io/docs/migrations/1.x-to-2.x
- **Import `whatwg-fetch`** in your own test or setup files. It's no longer a
  dependency of `@cedarjs/testing`. The Jest environment now provides native
  `fetch`/`Request`/`Response`, so you can usually just delete the import. If
  you still need it, add `whatwg-fetch` to your own devDependencies.
- **Customized `web/jest.config.js`** beyond the default preset. Don't
  override `testEnvironment` or `transformIgnorePatterns` — both are now
  load-bearing for msw to work under Jest.
- **Have a committed `web/public/mockServiceWorker.js`** (older projects). The
  MSW 1 worker is incompatible with the v2 client. Delete it — it's
  regenerated the next time you run `yarn cedar storybook`.

### `web/babel.config.js` is no longer used by Vite

The `cedar()` Vite plugin no longer feeds a default Babel config to
`@vitejs/plugin-react`. Previously, a `web/babel.config.js` file was picked up
and applied to every web file during dev and build. It no longer is — custom
Babel plugins or presets configured there silently stop running in the browser
bundle. (The file is still used for Jest tests and linting.)

If you rely on custom Babel plugins in your web build, pass them via the new
`babel` option instead:

```ts
// web/vite.config.ts
export default defineConfig({
  plugins: [cedar({ babel: { plugins: ['my-babel-plugin'] } })],
})
```

React Compiler users are unaffected: with `[experimental.reactCompiler]`
enabled in `cedar.toml` the compiler plugin is still injected, and it now
correctly merges with your own Babel plugins instead of being replaced by
them.

### GraphQL client-agnostic indirection removed

Cedar inherited code from Redwood that was meant to let apps swap Apollo for
another GraphQL client (the `GraphQLHooksProvider` context and a set of
overridable global types). The feature was never fully implemented and no one
uses it, so it has been removed. Cells and the hooks exported from
`@cedarjs/web` now call Apollo directly.

- Unaffected: `useQuery`, `useMutation`, and `useSubscription` imported from
  `@cedarjs/web` (they are now Apollo's hooks re-exported), Cells (including
  fragment Cells and `useFragment`), `mockGraphQLQuery`/`mockGraphQLMutation`,
  and the `graphQLClientConfig` prop on the Apollo provider.
- Breaking: `GraphQLHooksProvider` is no longer exported from `@cedarjs/web`.
  Apps that used it to plug in a non-Apollo GraphQL client must switch to
  Apollo — either `CedarApolloProvider` or their own `ApolloProvider` setup.
- Breaking: the ambient global types `QueryOperationResult`,
  `MutationOperationResult`, `GraphQLQueryHookOptions`,
  `GraphQLMutationHookOptions`, and `GraphQLOperationVariables` no longer
  exist. Import the equivalent types (`QueryResult`, `MutationTuple`,
  `QueryHookOptions`, `MutationHookOptions`, `OperationVariables`) from
  `@apollo/client` instead.

### `yarn cedar console` removed

The interactive api-side REPL has been removed from the CLI and now lives in a
standalone package, so the CLI no longer has to carry its dependencies. Run it
with:

```shell
yarn dlx @cedarjs/console
```

or `npx @cedarjs/console` if your app uses npm, or `pnpm dlx @cedarjs/console`
if it uses pnpm. No app-side changes are needed.

### Custom generator templates path removed

The deprecated `api/generators/` and `web/generators/` directories for custom
generator templates are no longer supported. This was deprecated in v2.3.0.

Move any custom templates to the root `generatorTemplates/` directory instead:

- `api/generators/<generator>/<template>` → `generatorTemplates/api/<generator>/<template>`
- `web/generators/<generator>/<template>` → `generatorTemplates/web/<generator>/<template>`

There's a codemod that does this for you:

```shell
yarn dlx @cedarjs/codemods move-generator-templates
```

### `getCommonPlugins()` removed

The `getCommonPlugins` export has been removed from `@cedarjs/babel-config`.
It has returned an empty array for a long time, so if you spread it into a
custom Babel or ESLint config, just delete the import and the
`...getCommonPlugins()` usage — no replacement is needed.

### Web dev server `Buffer` polyfill removed

`yarn cedar dev` no longer injects a global `Buffer` polyfill into web-side
code. The polyfill was only ever active in dev — production builds never had
it — so any web code relying on the global `Buffer` was already broken in
production, and now fails in dev too, surfacing the problem earlier.

Use web-native APIs instead (`Uint8Array`, `TextEncoder`/`TextDecoder`,
`atob`/`btoa`), or if you genuinely need `Buffer` in the browser, add
`vite-plugin-node-polyfills` to your own `web/vite.config.ts` — unlike the old
polyfill, that works in production builds too.

The polyfill only existed to support the dev fatal error page, and has been
replaced by the much lighter `cedarDataUriShim`. For those of you composing
your own Vite plugin pipeline from Cedar's individual plugin exports: the
`cedarNodePolyfills` export has been removed from `@cedarjs/vite` — swap it
for `cedarDataUriShim()`.

### Context-wrapping plugin renamed

The internal plugin that wraps api request handlers in `AsyncLocalStorage` (so
context never leaks between requests on serverless providers) has been renamed
to say what it does. No behavior change. This only affects advanced setups
that referenced it by name:

- `cedarContextWrappingPlugin` → `handlerAlsWrappingPlugin` (`@cedarjs/vite`)
- `applyContextWrapping` → `applyHandlerAlsWrapping`
- Vite plugin name `'cedar-context-wrapping'` → `'handler-als-wrapping'`
- `babel-plugin-redwood-context-wrapping` →
  `babel-plugin-handler-als-wrapping` (`@cedarjs/babel-config` deep imports)

### Apollo Client 4

`@cedarjs/web` now uses Apollo Client 4. Cells, the hooks re-exported from
`@cedarjs/web`, and `<FormError>` keep working unchanged, but app code that
imports from `@apollo/client` directly needs to be updated for Apollo
Client 4:

- React hooks and components now live in `@apollo/client/react`
- `ApolloError` is replaced by `CombinedGraphQLErrors` (GraphQL errors are in
  `error.errors`, not `error.graphQLErrors`) and network errors are no longer
  wrapped. This also applies to the `error` prop Cells pass to `Failure`
  components
- Custom Apollo links are rxjs-based now

See Apollo's migration guide for the full list:
https://www.apollographql.com/docs/react/migration/3.x-to-4.x
