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
