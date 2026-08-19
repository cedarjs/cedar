- feat(vite): Port babel-plugin-cedar-gqlorm-inject to Vite (#2070) by @lisa-assistant

Adds `vite-plugin-cedar-gqlorm-inject`, injecting the auto-generated gqlorm backend into GraphQL handler files at build time when gqlorm is enabled.

The plugin works in conjunction with `vite-plugin-cedar-graphql-options-extract` to mutate the sdls object in-place, enabling gqlorm schema and resolvers to be available to the GraphQL handler without breaking plugin composition.
