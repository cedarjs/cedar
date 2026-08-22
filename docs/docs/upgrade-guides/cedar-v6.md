---
title: CedarJS v6.0.0
description: Fragment Cells, a Vite-native build pipeline, and container-native deploys
toc_max_heading_level: 4
---

## Highlights

CedarJS v6 focuses on three things: a new Fragment Cell for cutting query
waterfalls between components, a build pipeline that's fully Vite instead of
half Babel, and deploying to a plain container host with as close to zero
config as we can get you.

### Fragment Cells

Cells can now declare their data requirements with a `FRAGMENT` export instead
of firing a query of their own. A parent Cell spreads the fragment in its
`QUERY` and passes the matching slice of the result down as a prop named after
the fragment, so nested Cells no longer create request waterfalls — one single
GraphQL request fetches everything.

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
import AuthorCell from 'src/components/AuthorCell'

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

Fragment Cells automatically register their fragment with the GraphQL client, so
spreading it by name is enough — no imports or interpolation needed. When the
fragment selects the type's `id`, the Cell reads its data live from the Apollo
cache and re-renders when mutations update the entity. See "Fragment Cells:
Aggregating Queries" in the [Cells docs](/docs/cells).

### A Vite-native build pipeline

Cedar's custom Babel plugins have been ported to native Vite plugins:
directory-named imports, GraphQL options extraction, gql tag handling, mock Cell
data, OpenTelemetry wrapping, job path injection, and the
`src/`/`$api/`/tsconfig-paths aliases. Transforms that Vite already handles
natively are no longer duplicated through Babel. Unless you enable the React
Compiler, Babel is now entirely out of the web build — faster transforms,
correct sourcemaps, and fewer configuration edge cases.

### Deploy: standard container-host conventions

A generated Cedar app now deploys to a container host — Railway, Render, Fly.io,
Google Cloud Run, Coolify, Dokku, Dokploy, Koyeb, Northflank, and similar — with
little to no platform-specific configuration:

- Generated apps ship `build`/`dev`/`start`/`start:api`/`start:web` scripts in
  their root `package.json`, so zero-config builders that detect a `start`
  script (Railpack, Nixpacks, Paketo, Google Cloud buildpacks) can boot a Cedar
  app with no Dockerfile.
- `cedar serve` and `cedar serve api` read the `PORT`/`HOST` environment
  variables every container PaaS sets, instead of requiring an explicit
  `--port`/`--host`.
- `yarn cedar setup database postgres` converts a project from SQLite to
  Postgres — schema, Prisma adapter, config — without also provisioning a Neon
  database, so the conversion isn't locked to one provider anymore.

### Background jobs: enforced timeouts and cancellation

A job that runs past `maxRuntime` is now permanently failed by the worker
running it, instead of silently staying eligible for another worker to pick up
and re-run concurrently. Jobs can opt into cooperative cancellation via
`getJobExecutionContext()`, and queued or running jobs can be cancelled
directly:

```ts
import { getJobExecutionContext } from '@cedarjs/jobs'

perform: async () => {
  const context = getJobExecutionContext()
  await fetch(url, { signal: context?.signal })
}
```

```ts
const scheduledJob = await later(SampleJob, [args])
await later.cancel(scheduledJob.id)
```

### `configureGraphQLServer` and `configureServer` for the API server

`createServer()` gains two configuration hooks alongside the existing
`configureApiServer`: `configureGraphQLServer`, scoped to the GraphQL route, and
`configureServer`, which runs on the root Fastify instance before either the api
functions or the GraphQL plugin register their routes — the right place for
plugins with a "global" registration mode, like `@fastify/compress`, that only
affect routes registered after them. This also fixes a bug where registering
compression through `configureApiServer` alone only ever compressed api-function
responses, never GraphQL responses.

### Better DX for AI coding agents

A batch of fixes came out of watching an AI coding agent build a Cedar app
end-to-end and tracking down every place it got stuck or produced insecure code
— `cedar generate scaffold` now wraps generated routes in `<PrivateSet>`
automatically when auth is set up, `cedar check` warns when a route isn't
protected but its page calls an `@requireAuth` mutation,
`cedar generate sdl`/`scaffold` generate read-only stubs for related models
instead of leaving the project broken, and dbAuth's sensitive fields
(`hashedPassword`, `salt`, `resetToken`, ...) are now excluded by name from
generated SDL, inputs, and scaffolds.

There's plenty more in this release — more Redwood → Cedar renaming, CLI
improvements, and smaller fixes. The
[v6.0.0 release on GitHub](https://github.com/cedarjs/cedar/releases/tag/v6.0.0)
has the full, PR-by-PR list.

## Upgrade Guide

### Breaking changes

This is a big release with a number of breaking changes. Skim the list below,
find the ones that apply to your app, then follow the steps in
[Let's get started](#lets-get-started).

- **[Vitest 4 (ESM projects)](#vitest-4-esm-projects-only)**
- **[Legacy ESLint config format removed](#migrate-to-flat-eslint-config)**
- **[`@cedarjs/core` no longer pulls in
  `@cedarjs/eslint-config`](#migrate-to-flat-eslint-config)**
- **[`web/babel.config.js` is no longer used by
  Vite](#webbabelconfigjs-changes)**
- **[Custom generator templates path
  removed](#custom-generator-templates-path-removed)**
- **[MSW 2](#msw-2)**
- **[`cedar serve api --ud` binds to all interfaces by
  default](#cedar-serve-api---ud-binds-to-all-interfaces-by-default)**
- **[Web dev server `Buffer` polyfill
  removed](#web-dev-server-buffer-polyfill-removed)**
- **[`yarn cedar setup neon` now requires `--migrations`/`--no-migrations` in
  non-interactive
  shells](#yarn-cedar-setup-neon-requires-an-explicit-migrations-flag-in-ci)**
- **[`yarn cedar console` removed](#yarn-cedar-console-removed)**
- **[No more CJS-only packages](#no-more-cjs-only-packages)**
- **[`getCommonPlugins()` removed](#getcommonplugins-removed)**
- **[Context-wrapping plugin renamed](#context-wrapping-plugin-renamed)**
- **[GraphQL client-agnostic indirection
  removed](#graphql-client-agnostic-indirection-removed)**

If you want to see every single change in this release, including all the PRs
that went into it, check the
[release notes on GitHub](https://github.com/cedarjs/cedar/releases/tag/v6.0.0).

### Let's get started!

#### Begin with the latest v5

It's always best to start from the latest previous version. Make sure you're on
v5.0.6 (the latest v5 release) and everything is working as expected before
upgrading to v6:

```bash
yarn cedar upgrade -t 5.0.6
```

#### Running the upgrade command

Now you're ready to upgrade to v6:

```bash
yarn cedar upgrade
```

If you want to try a pre-release/RC build instead, target `rc`:

```bash
yarn cedar upgrade -t rc
```

#### Vitest 4 (ESM projects only)

If your project is ESM, it runs tests with Vitest, which Cedar has upgraded from
v3 to v4:

1. Bump `vitest` to `4.1.10` in your root `package.json`.
2. Pin Vite to the version Cedar uses. If you do not pin it, Vitest 4 will pull
   in its own copy of Vite 8, and web tests will fail to parse JSX.

   For `yarn`, add this to your root `package.json`:

   ```json
   "resolutions": {
     "vite": "7.3.6"
   }
   ```

   For `npm`, add this to your root `package.json`:

   ```json
   "overrides": {
     "vite": "7.3.6"
   }
   ```

   For `pnpm`, add this to your `pnpm-workspace.yaml`:

   ```yaml
   overrides:
     vite: '7.3.6'
   ```

Cedar's generated `vitest.config.ts` files are already compatible with Vitest 4.
However, your own tests and config customizations may hit some of Vitest 4's
breaking changes. The most common ones are the removal of
`poolOptions`/`minWorkers`/`maxThreads`/`minThreads`, `workspace` being renamed
to `projects`, and `vi.restoreAllMocks()` only restoring `vi.spyOn` spies rather
than `vi.fn()` mocks. See the
[Vitest migration guide](https://vitest.dev/guide/migration) for the full list.

#### Migrate to flat ESLint config

If your project still uses `.eslintrc.js` or the `eslintConfig` field in
`package.json`, you need to migrate to flat config — there's no codemod for this
one, it has to be done by hand. Create an `eslint.config.mjs` (or `.js` if you
want and your project is ESM) in your project:

```javascript
import cedarConfig from '@cedarjs/eslint-config'

export default await cedarConfig()
```

If you had custom rules in the old config, add them in an extra config object
after Cedar's:

```javascript
import cedarConfig from '@cedarjs/eslint-config'

export default [
  ...(await cedarConfig()),
  {
    rules: {
      // Your custom rules here
    },
  },
]
```

Then delete `.eslintrc.js` and remove the `eslintConfig` field from
`package.json`. See
[`packages/eslint-config/README.md`](https://github.com/cedarjs/cedar/blob/main/packages/eslint-config/README.md)
for the full guide.

**If your project was migrated from RedwoodJS by hand** (search-and-replace,
rather than generated via `create-cedar-app`), it may only have `@cedarjs/core`
in its root `devDependencies` and have been relying on that transitively
pulling in `@cedarjs/eslint-config`. That no longer happens, so add it
explicitly:

```shell
yarn add -D @cedarjs/eslint-config@6.0.0
```

#### `web/babel.config.js` changes

The `cedar()` Vite plugin no longer feeds a default Babel config to
`@vitejs/plugin-react`, so custom Babel plugins/presets in `web/babel.config.js`
silently stop running in the browser bundle (the file is still used for Jest
tests and linting). If you rely on custom Babel plugins in your web build, pass
them via the new `babel` option instead:

```ts
// web/vite.config.ts
export default defineConfig({
  plugins: [cedar({ babel: { plugins: ['my-babel-plugin'] } })],
})
```

#### Custom generator templates path removed

The deprecated `api/generators/` and `web/generators/` directories for custom
generator templates are no longer supported. Move any custom templates to
`generatorTemplates/` instead — there's a codemod:

```shell
yarn dlx @cedarjs/codemods move-generator-templates
```

#### MSW 2

`@cedarjs/testing` now uses MSW 2 internally. Cedar's own mocking API
(`mockGraphQLQuery`, `mockGraphQLMutation`, `mockCurrentUser`, Cell `*.mock.ts`
files) is unchanged, and most apps need no action. You do need to act if you:

- **Import from `msw` directly** in tests or stories — MSW 2 renamed `rest` to
  `http`, resolvers return an `HttpResponse`, and `setupWorker` moved to
  `msw/browser`. See the
  [MSW migration guide](https://mswjs.io/docs/migrations/1.x-to-2.x).
- **Import `whatwg-fetch`** in your own test/setup files — it's no longer a
  dependency of `@cedarjs/testing`; you can usually just delete the import.
- **Customized `web/jest.config.js`** beyond the default preset — don't override
  `testEnvironment` or `transformIgnorePatterns`, both are now load-bearing for
  MSW under Jest.
- **Have a committed `web/public/mockServiceWorker.js`** — delete it, it's
  regenerated the next time you run `yarn cedar storybook`.

#### `cedar serve api --ud` binds to all interfaces by default

`cedar serve api --ud` used to read `process.env.PORT` directly and bind to
`localhost`. It now goes through the same host/port resolution as every other
`serve` path, so its default host changes from `localhost` to `::` in dev /
`0.0.0.0` in production — matching `cedar serve`/`cedar serve api` elsewhere.
This makes a locally-run api reachable from other hosts on the network. If you
relied on it only being reachable from localhost, pass `--host localhost`
explicitly:

```bash
yarn cedar serve api --ud --host localhost
```

This doesn't affect `cedar dev --ud`, which handles api routes in-process
through the Vite dev server.

#### Web dev server `Buffer` polyfill removed

`yarn cedar dev` no longer injects a global `Buffer` polyfill into web-side
code. Use `Uint8Array`/`TextEncoder`/`TextDecoder`/`atob`/`btoa` instead, or add
`vite-plugin-node-polyfills` to your own `web/vite.config.ts` if you genuinely
need `Buffer` in the browser.

#### `yarn cedar setup neon` requires an explicit migrations flag in CI

It now supports `--migrations`/`--no-migrations` to control whether Prisma
migrations run after provisioning. Run interactively, it prompts when the flag
is omitted; run in a non-interactive shell (CI/CD) with the flag omitted, it
now exits 1 instead of running migrations automatically like before. Pass
`--migrations` explicitly in scripted/CI usage of `yarn cedar setup neon`.

#### `yarn cedar console` removed

Run `yarn dlx @cedarjs/console` instead.

#### No more CJS-only packages

Every `@cedarjs/*` package that used to be CommonJS-only or dual-mode has moved
to ESM-only, except `@cedarjs/prerender`, `@cedarjs/testing`, and
`@cedarjs/project-config`, which stay dual-mode for now.

For a standard generated Cedar app this isn't breaking — framework code is
always reached either through a plain `import` or, for API-side CJS-template
projects, through Babel-transpiled `require()` calls, and Node 24 transparently
handles `require()`-ing an ESM module. No action is needed if you import these
packages the standard way, through the generated templates.

It's only breaking if you compile your own TypeScript straight to CommonJS
with `tsc` (not Babel) and statically `import` a `@cedarjs/*` package — for
example, a custom auth integration built directly against
`@cedarjs/auth-*-api`. `tsc` refuses to emit a static `require()` for a module
it resolves as ESM-only (`TS1479`/`TS1541`), even though Node can handle it at
runtime. If you hit this, switch the value import to a dynamic `import()`, or
for type-only imports, add a `resolution-mode: 'import'` attribute:

```ts
import type { Foo } from '@cedarjs/some-package' with {
  'resolution-mode': 'import',
}
```

#### `getCommonPlugins()` removed

`getCommonPlugins` has been removed from `@cedarjs/babel-config`. Delete any
`...getCommonPlugins()` usage.

#### Context-wrapping plugin renamed

The internal plugin that wraps api request handlers in `AsyncLocalStorage` (so
context never leaks between requests on serverless providers) has been renamed
to say what it does. No behavior change, but if you reference it by name:
`cedarContextWrappingPlugin` → `handlerAlsWrappingPlugin` (`@cedarjs/vite`),
`applyContextWrapping` → `applyHandlerAlsWrapping`, and the Vite plugin name
`'cedar-context-wrapping'` → `'handler-als-wrapping'`.

#### GraphQL client-agnostic indirection removed

`GraphQLHooksProvider` is no longer exported from `@cedarjs/web`. If you used it
to plug in a non-Apollo GraphQL client, switch to `CedarApolloProvider` or your
own `ApolloProvider` setup. The ambient global types `QueryOperationResult`,
`MutationOperationResult`, `GraphQLQueryHookOptions`,
`GraphQLMutationHookOptions`, and `GraphQLOperationVariables` no longer exist —
import `QueryResult`, `MutationTuple`, `QueryHookOptions`,
`MutationHookOptions`, and `OperationVariables` from `@apollo/client` instead.
`useQuery`, `useMutation`, `useSubscription`, and Cells are unaffected.

### Things to watch out for

#### Prisma Client

Make sure you've generated a new Prisma client once you've upgraded. Even though
the upgrade regenerates the client, you may need to run
`yarn cedar prisma generate` again to avoid errors.

#### More Redwood → Cedar renaming

Several more public APIs now have Cedar-named counterparts —
`RedwoodApolloProvider` → `CedarApolloProvider`, `RedwoodProvider` →
`CedarProvider`, the GraphQL Yoga plugins (`useRedwoodDirective` →
`useCedarDirective`, and similar), and `RedwoodError`/`RedwoodLoggerOptions` →
`CedarError`/`CedarLoggerOptions`. The Redwood-named originals keep working as
deprecated aliases — nothing breaks — but update to the new names when
convenient, since the old ones will be removed in a future release.
