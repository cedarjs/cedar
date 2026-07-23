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

### CedarApolloProvider

Continuing the move from Redwood to Cedar naming, `RedwoodApolloProvider` is
now `CedarApolloProvider`, imported from a dedicated subpath:

```tsx
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'
```

`RedwoodApolloProvider` keeps working as a deprecated alias, but it will be
removed in a future release, so update your `web/src/App.tsx` when convenient.

### A Vite-native build pipeline

Cedar's custom Babel plugins have been ported to native Vite plugins for
projects on the Vite-based pipeline: directory-named imports, GraphQL options
extraction, gql tag handling, mock Cell data, OpenTelemetry wrapping, job path
injection, and the `src/`/`$api/`/tsconfig-paths aliases. Transforms that Vite
already handles natively are no longer duplicated through Babel. Unless you
enable the React Compiler, Babel is now entirely out of the web build — faster
transforms, correct sourcemaps, and fewer configuration edge cases. (See the
breaking `web/babel.config.js` change below if you have a custom Babel setup.)

### Testing now works in pnpm projects

`yarn cedar test` used to fail before running a single test in pnpm projects
because the Jest presets assumed a hoisted `node_modules` layout. Module paths
are now resolved properly, msw interop understands pnpm's `.pnpm` store paths,
and CI now continuously exercises real pnpm and npm test projects alongside
yarn.

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
- Projects located in filesystem paths containing spaces now work correctly.
- API functions returning status 204, 205, or 304 no longer crash under the
  fetch-native runtime.

## Breaking changes

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
     "vite": "7.3.5"
   }
   ```

   npm — in your root `package.json`:

   ```json
   "overrides": {
     "vite": "7.3.5"
   }
   ```

   pnpm — in your `pnpm-workspace.yaml`:

   ```yaml
   overrides:
     vite: '7.3.5'
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

### MSW 2 (web-side Jest tests and Storybook)

`@cedarjs/testing` now uses MSW 2 internally (up from MSW 1). Cedar's mocking
API is unchanged: `mockGraphQLQuery`, `mockGraphQLMutation`, `mockCurrentUser`,
and Cell `*.mock.ts` files keep working as before, including the
`(variables, { ctx, req })` data-function signature. Most apps need no changes.

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

(or `npx @cedarjs/console` / `pnpm dlx @cedarjs/console`). No app-side changes
are needed.

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
