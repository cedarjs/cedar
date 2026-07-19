## Custom generator templates path removed

The deprecated `api/generators/` and `web/generators/` directories for custom
generator templates are no longer supported. This was deprecated in v2.3.0.

Move any custom templates to the root `generatorTemplates/` directory instead:

- `api/generators/<generator>/<template>` → `generatorTemplates/api/<generator>/<template>`
- `web/generators/<generator>/<template>` → `generatorTemplates/web/<generator>/<template>`

## RWJS_DELAY_RESTART removed

The `RWJS_DELAY_RESTART` environment variable has been removed. It was renamed
to `CEDAR_DELAY_API_RESTART` in a previous release. If you still have
`RWJS_DELAY_RESTART` in your `.env` file, rename it to `CEDAR_DELAY_API_RESTART`.

## cedar-gen

Public:
rw-gen -> cedar-gen

Internal:
REDWOOD_ENV_FILES_LOADED -> CEDAR_ENV_FILES_LOADED

## .cedar/

This isn't breaking, but I wanted to call it out anyway, and recommend you
update your own projects too

Cedar apps now default to a top level `.cedar/` directory for generated types,
GraphQL schema, and other transitory data

With both a `cedar.toml` file and a `.cedar/` directory it should be much more
clear to those working on the app that it's a Cedar app and nothing else.

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
