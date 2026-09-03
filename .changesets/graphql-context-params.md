- fix(graphql-server): Declare `params` on the GraphQL context type

A `context` function passed to `createGraphQLHandler` runs after Yoga has parsed
the request, so the context it receives carries the operation's query, variables
and operation name on `params`. `CedarGraphQLContext` declares
`params: GraphQLParams`, so reading a variable is a direct property access:

```ts
const params = gqlContext.params
```

Tests pin both the variables and the request being available to a `context`
function.
