- fix(graphql-server): Declare `params` on the GraphQL context type

A `context` function passed to `createGraphQLHandler` runs after Yoga has parsed
the request, so the context it receives carries the operation's query, variables
and operation name on `params`. The type did not say so, and the interface's
index signature widened it to `unknown`, so reading a variable meant casting:

```ts
const params = gqlContext.params as
  { variables?: Record<string, unknown> } | undefined
```

`CedarGraphQLContext` now declares `params: GraphQLParams`, so the cast is
unnecessary. Tests pin both the variables and the request being available to a
`context` function.
