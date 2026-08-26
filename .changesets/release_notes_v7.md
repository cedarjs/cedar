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
