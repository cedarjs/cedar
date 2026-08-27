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

## `yarn cedar setup tsconfig` removed

The `setup tsconfig` CLI command, which added `tsconfig.json` files to an
existing JavaScript project so it could start using TypeScript, has been
removed. Choose TypeScript up front with `yarn create cedar-app --typescript`,
or convert an existing JavaScript project manually—see
[Converting a JavaScript Project to TypeScript](https://cedarjs.com/docs/typescript/introduction#converting-a-javascript-project-to-typescript).

