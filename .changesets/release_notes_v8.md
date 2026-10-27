## Apollo Client 4

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

### `skip` is deprecated in favor of `skipToken`

Apollo Client 4.3 deprecates the `skip` option on `useQuery` and
`useSubscription`. `skip` still works, but `skipToken` is more type-safe:
passing it as the whole options argument, instead of
`{ skip: true, variables: {...} }`, keeps required variables type-safe without
a non-null assertion like `id!` or a placeholder value.

```tsx
import { skipToken } from '@apollo/client/react'
import { useQuery } from '@cedarjs/web'

const { data } = useQuery(query, id ? { variables: { id } } : skipToken)
```

`@cedarjs/web` doesn't re-export `skipToken`, so import it from
`@apollo/client/react`. Cells accept `skipToken` from `beforeQuery` too. See
Apollo's
[`skipToken` docs](https://www.apollographql.com/docs/react/api/react/skipToken)
for the full API.

## ESM-only projects

Cedar projects are ESM-only. Every side's `package.json` must have
`"type": "module"`, `create-cedar-app` always generates an ESM project (the
`--esm` flag is gone), and the framework no longer detects or branches on a
project's module format.

This also means:

- `yarn cedar test` always runs Vitest. The Jest presets
  (`@cedarjs/testing/config/jest/*`), the `jest` bin and the
  `jest.config.js` project files are no longer supported.
- Packages generated with `yarn cedar g package` always get a
  `vitest.config.ts`.
- The API side is always built as ESM, and generated realtime subscriptions
  use `import { gql } from 'graphql-tag'`.

If your project is still CJS, follow the ESM migration steps in the v6 upgrade
guide before upgrading.

## All framework packages are ESM-only

`@cedarjs/prerender`, `@cedarjs/testing` and `@cedarjs/project-config` no
longer ship a CommonJS build, so every `@cedarjs/*` package is ESM-only. Node
24 handles `require()`-ing an ESM module, so config files like
`graphql.config.cjs` (`require('@cedarjs/project-config')`) keep working. The
only breaking case is compiling your own TypeScript straight to CommonJS with
`tsc` and statically importing one of these packages; use a dynamic `import()`
there.

## `yarn cedar setup tsconfig` removed

The `setup tsconfig` CLI command, which added `tsconfig.json` files to an
existing JavaScript project so it could start using TypeScript, has been
removed. Choose TypeScript up front with `yarn create cedar-app --typescript`,
or convert an existing JavaScript project manually—see
[Converting a JavaScript Project to TypeScript](https://cedarjs.com/docs/typescript/introduction#converting-a-javascript-project-to-typescript).

## `yarn cedar ts-to-js` removed

The deprecated `ts-to-js` CLI command, which converted a TypeScript project to
JavaScript, has been removed. Cedar has no built-in way to convert a project
from TypeScript to JavaScript. If you need a JavaScript project, generate one
with `yarn create cedar-app --no-typescript`.

## JSX is only compiled in `.jsx` and `.tsx` files

Vite compiles JSX only in files with a `.jsx` or `.tsx` extension. A `.js`
file on the web side that contains JSX fails `yarn cedar build web` with a
parse error (`Expression expected`) pointing at the first JSX tag. Rename such
files to `.jsx`. The pre-upgrade check run by `yarn cedar upgrade` lists every
`.js` file it finds JSX in.

## Nodemailer 9

`@cedarjs/mailer-handler-nodemailer` uses Nodemailer 9. The handler API is
unchanged, but Nodemailer now validates TLS certificates when it fetches
remote content over HTTPS: attachments with an `href` or `path` URL, OAuth2
token endpoints and HTTP proxy `CONNECT` requests. Fetching from a host with a
self-signed, expired or hostname-mismatched certificate fails where it used to
succeed. Opt out per transport with `tls: { rejectUnauthorized: false }` in
the transport options, or per attachment with the attachment's `tls` option.

## MJML mailer renderer uses MJML 5

`@cedarjs/mailer-renderer-mjml-react` renders with MJML 5 and
`@faire/mjml-react` 4. Rendering is asynchronous, which `Mailer.send` handles
transparently; only code that calls `MJMLReactRenderer.render()` directly
needs to `await` the result. MJML 5 minifies with htmlnano and cssnano,
generates the `<body>` tag from `mj-body` (the `class` attribute lands on
`<body>`, `background-color` only on the inner `div`), ignores `mj-include`
unless `includePath` is configured, and accepts any string for
`border-radius`. Expect small differences in the generated HTML if you
compare rendered output byte for byte.

## Middleware route `params` is a null-prototype object

`@cedarjs/vite` matches `registerMiddleware()` route patterns with
`find-my-way` v9. The `params` object passed to middleware as
`options.params` has no `Object.prototype` on its chain. Reading keys,
spreading, `Object.keys()`, the `in` operator and `JSON.stringify()` all work
as expected, but calling `options.params.hasOwnProperty(...)` or
`options.params.toString()` throws a `TypeError`. Use
`Object.hasOwn(options.params, key)` for ownership checks.

## `api/babel.config.js` needs Babel installed in the api workspace

`@cedarjs/babel-config` lists `@babel/core` and `@babel/preset-typescript` as
optional peer dependencies and resolves them from the project's api workspace
when `api/babel.config.js` exists. Projects without a custom api-side Babel
config are unaffected. Projects that have an `api/babel.config.js` must
install the two packages themselves, or the api build fails with an error
pointing to this command:

```shell
yarn workspace api add -D @babel/core@^7 @babel/preset-typescript@^7
```

## dbAuth requires a `changePassword` option

`DbAuthHandler` has a change password flow for users who are already logged
in, and its `changePassword` option is required, like `login`, `signup`,
`forgotPassword` and `resetPassword`. A TypeScript auth function without it
fails type-check. The pre-upgrade check run by `yarn cedar upgrade` lists the
files that need it and prints the code to add.

To keep the flow turned off, add this to the options passed to
`new DbAuthHandler(...)` in `api/src/functions/auth`:

```ts
changePassword: { enabled: false },
```

To offer it, pass the full options instead (see the
[dbAuth docs](https://cedarjs.com/docs/auth/dbauth#changepassword)) and
generate the page with
`yarn cedar g dbAuth --skip-forgot --skip-login --skip-reset --skip-signup`.

## Tailwind CSS v4

`yarn cedar setup ui tailwindcss` sets up Tailwind CSS v4 with Tailwind's
Vite plugin, `@tailwindcss/vite`. Tailwind is configured in CSS, with
`@import 'tailwindcss';` at the top of `web/src/index.css`; there is no
`tailwind.config.cjs` or PostCSS config. The Tailwind version of
`scaffold.css` generated by `yarn cedar g scaffold` uses v4 syntax
(`@reference './index.css'`) and doesn't compile with Tailwind v3.

Projects on Tailwind v3 need to migrate. `yarn cedar upgrade` detects them
and prints the steps, which start with Tailwind's upgrade tool:

```shell
npx @tailwindcss/upgrade --config ./web/config/tailwind.config.cjs
```

See Tailwind's [upgrade guide](https://tailwindcss.com/docs/upgrade-guide) for
the changes v4 makes to utilities and configuration.

## TypeScript strict mode in new projects

New TypeScript projects created with `yarn create cedar-app` have TypeScript's
`strict` mode turned on in `web/tsconfig.json`, `api/tsconfig.json` and
`scripts/tsconfig.json`. The code Cedar's generators and setup commands write
type-checks with `strict` on.

It's recommended to turn strict mode on in your existing project by adding
`"strict": true` to `compilerOptions` in each of your tsconfig files. Then run
`yarn cedar g types` and `yarn cedar type-check`. Code generated before v8 may
need a few changes; see
[TypeScript Strict Mode](https://cedarjs.com/docs/typescript/strict-mode) for
the common ones.

Strict mode relies on the types described in "More precise generated types"
below. The SDL generator also writes Prisma scalar and enum lists with
non-nullable items (`tags: [String!]!`), because Prisma lists never contain
`null`.

## More precise generated types

To better support TypeScript's strict mode a few of the types Cedar generates
and exports are made more precise.

- `QueryResolvers` and `MutationResolvers` fields are required properties, so
  service functions typed with them (`QueryResolvers['posts']`) aren't
  possibly `undefined` when you call them in tests
- On the api side, `JSON` and `JSONObject` inputs are typed as Prisma's
  `InputJsonValue` and `InputJsonObject`, the types Prisma accepts for `Json`
  fields
- `@cedarjs/auth` exports a new `LoggedInUser` type: the user
  `getCurrentUser` returns when someone is logged in. `CurrentUser` is
  `LoggedInUser | null`, matching what `getCurrentUser` returns.

### Upgrading

- Where your code uses `CurrentUser` for a user that's known to be logged in,
  use `LoggedInUser` instead. Without strict mode TypeScript ignores `null`, so
  this only matters in projects with `strict` (or `strictNullChecks`) on
- If you extend `CurrentUser` with `declare module '@cedarjs/auth'`, extend
  `LoggedInUser` instead. `CurrentUser` is a type alias and can't be extended

## `<Set>` wrappers only get `children`

`<Set>`, `<PrivateSet>` and `<Private>` render the components in `wrap` with
the wrapped routes as `children`, and no other props, so props meant for the
wrappers are a type error on a Set. `Set`, `PrivateSet` and `Private` take no
type argument. `@cedarjs/router` exports `WrapperProps`, the props a component
in `wrap` gets (`children`), and `WrapperType`, the type of such a component,
without a type argument.

`yarn cedar g scaffold post` generates a `PostsScaffoldLayout` that renders the
shared `ScaffoldLayout` with the title and links for posts, and wraps the
routes in `<Set wrap={PostsScaffoldLayout}>`. The layout's props, like
`titleTo`, are type checked against your route names, also with TypeScript's
`strict` mode turned on. `yarn cedar d scaffold post` removes the layout again.

The pre-upgrade check run by `yarn cedar upgrade` lists every Set that has
props for its wrappers, with its file, line, wrappers and props, and stops the
upgrade until they're fixed. For each of them, create a layout component that
renders the wrapper with those props, and use it in `wrap`:

```tsx title="web/src/layouts/PostsScaffoldLayout/PostsScaffoldLayout.tsx"
import type { WrapperProps } from '@cedarjs/router'

import ScaffoldLayout from 'src/layouts/ScaffoldLayout'

function PostsScaffoldLayout({ children }: WrapperProps) {
  return (
    <ScaffoldLayout
      title="Posts"
      titleTo="posts"
      buttonLabel="New Post"
      buttonTo="newPost"
    >
      {children}
    </ScaffoldLayout>
  )
}

export default PostsScaffoldLayout
```

```diff title="web/src/Routes.tsx"
-import ScaffoldLayout from 'src/layouts/ScaffoldLayout'
+import PostsScaffoldLayout from 'src/layouts/PostsScaffoldLayout'

-<Set wrap={ScaffoldLayout} title="Posts" titleTo="posts" buttonLabel="New Post" buttonTo="newPost">
+<Set wrap={PostsScaffoldLayout}>
```

`WrapperProps` is available in Cedar v7.x too, so you can make this change
before upgrading.

## `<PrivateSet>` redirects: `unauthorized` and route params

`<PrivateSet>` takes an `unauthorized` route, for users who are signed in but
don't have the set's `roles`. Without it, they're redirected to
`unauthenticated` as before.

```tsx
<PrivateSet unauthenticated="login" unauthorized="forbidden" roles="admin">
```

The `unauthenticated` and `unauthorized` routes can have path params, as long
as the route the user tried to visit has params with the same names: the
router fills them in from it. Before, a redirect to a route with params threw
"would require route parameters, which currently is not supported". It still
throws, with a clearer message, if a param is missing.

Also, `$&`, `$1` and similar in a route param value, such as
`routes.post({ slug: 'a$&b' })`, stay as they are. They used to be expanded
like replacement patterns.

## `removeNulls` is typed and only changes top-level fields

`removeNulls` from `@cedarjs/api` returns a copy of its input where every
top-level `null` is `undefined`, typed as `RemoveNulls<T>`. TypeScript checks
`db.post.update({ data: removeNulls(input) })` against Prisma's types, also in
strict mode, so a field with the wrong type is a type error.

Nested objects and arrays are passed through as they are, so `null`s inside a
`Json` field value are kept. The input object is left unchanged. If your code
relies on `removeNulls` also converting `null`s in nested objects, call
`removeNulls` on those objects yourself.

## `currentUser` is typed as exactly what `getCurrentUser` returns

`CurrentUser` and `LoggedInUser` from `@cedarjs/auth` have exactly the fields
of your `getCurrentUser` return type, with no extra `[key: string]: unknown`
fields. Misspelled fields like `currentUser.emial` are type errors, and an
`interface` you use as the return type of `getCurrentUser` is accepted
anywhere a `CurrentUser` is expected.

Reading a field that `getCurrentUser` doesn't return is a type error:

```
Property 'organizationId' does not exist on type 'LoggedInUser'.
```

To fix it, add the field to what `getCurrentUser` returns (for example to
the `select` in your `db.user.findUnique` call), or stop reading it. The same
applies to `mockCurrentUser()` in tests: the object you pass must match the
`getCurrentUser` return type.

## Your app owns its copy of Prisma

Cedar uses the `prisma` and `@prisma/client` your app installs instead of
installing its own copies, so every app has exactly one copy of each. Your
app needs:

- `prisma` in the `devDependencies` of the root `package.json`
- `@prisma/client` in the `dependencies` of `api/package.json`

Both must be on the version Cedar supports, which `@cedarjs/cli` declares as
its `prisma` peer dependency. Apps created before these entries were part of
the app template, including apps migrated from Redwood, often don't have
them yet.

When either is missing, `yarn cedar upgrade` stops before changing anything
and lists what to add, with the Prisma version to use. Add them and run the
upgrade again. From then on, every `yarn cedar upgrade` sets `prisma`,
`@prisma/client` and any `@prisma/adapter-*` packages to the version Cedar
supports, and adds `prisma` and `@prisma/client` if they go missing. If you
upgrade your Cedar packages without `yarn cedar upgrade`, add them yourself.

## Lint rule: GraphQL selections must include `id`

`@cedarjs/eslint-config` lints the `gql` documents in `web/src` against your
app's GraphQL schema, with
[`@graphql-eslint/require-selections`](https://the-guild.dev/graphql/eslint/rules/require-selections)
as an error: every selection of an object type that has an `id` field must
select `id`.

Apollo's cache can only normalize an object when the query selects its
`id`. When one query selects `currentOrganization { timezone }` and another
selects `currentOrganization { id features }`, the two copies replace each
other in the cache and the queries refetch each other. Apollo stops the loop
on its own and logs "Cache data may be lost when replacing the … field" in
development, but GraphQL validation, type generation and tests all accept
the queries.

Fragment spreads are checked too: a spread of a fragment that doesn't select
`id`, a fragment Cell's `FRAGMENT` for example, is reported where it's
spread.

The schema the rule reads is `.cedar/schema.graphql`, which
`yarn cedar generate types` and `yarn cedar dev` write. `yarn cedar lint`
generates it when it's missing, so the rule runs in CI too. ESLint on its
own (an editor, or `yarn eslint`) skips the rule until the file exists.

### Upgrading

Run `yarn cedar lint` and add `id` where it's reported. The Cells Cedar generates already select `id`, so most of
what's reported is in hand-written or since-extended queries. After adding
the ids:

- Run `yarn cedar generate types` again. The generated types now include
  `id`, so test data and mocks typed with them need an `id` too
- Give mocked responses (`mockGraphQLQuery`, Cell `.mock` files) the newly
  selected `id`s. Apollo treats a result that's missing a selected field as
  incomplete and fetches it again, which shows up in tests that count
  requests

To keep the rule as a warning while you work through the list, add this
after Cedar's config in `eslint.config.mjs`:

```js
{
  files: ['web/src/**/*.graphql'],
  rules: {
    '@graphql-eslint/require-selections': 'warn',
  },
},
```
