---
description: Prisma-inspired GraphQL query builder with automatic schema generation and live queries
---

# gqlorm

`gqlorm` is a Prisma-inspired GraphQL query builder that lets you fetch data
from your Cedar backend using an ORM-style API on the frontend. Instead of
hand-writing GraphQL documents, you write familiar Prisma-like queries and
gqlorm generates the GraphQL for you — complete with live-query support.

```tsx
// Before: writing GraphQL by hand
const QUERY = gql`
  query FindTodos {
    todos {
      id
      title
      body
      done
    }
  }
`

// With gqlorm: Prisma-style queries
const { data } = useLiveQuery((db) => db.todo.findMany())
```

:::caution

gqlorm is an **experimental** feature. Enable it in `cedar.toml` and expect APIs
to evolve as the feature matures.

:::

## What gqlorm provides

- **Auto-generated GraphQL types and resolvers** from your Prisma schema — no manual SDL required for basic CRUD reads
- **ORM-style query builder** on the frontend: `db.todo.findMany()`, `db.post.findUnique({ where: { id: 1 } })`, etc.
- **Live queries out of the box** via the `useLiveQuery` hook, which automatically adds the `@live` directive
- **Automatic auth scoping** — queries are scoped to the current user and organization when your schema includes membership fields
- **Sensitive-field filtering** — fields like `password`, `secret`, and `token` are hidden from the GraphQL API by default

## Enabling gqlorm

Add the experimental flag to your `cedar.toml`:

```toml title="cedar.toml"
[experimental.gqlorm]
enabled = true
```

When you run `yarn cedar dev` or `yarn cedar build`, Cedar generates three
artifacts in `.cedar/`:

| File                                           | Purpose                                                            |
| :--------------------------------------------- | :----------------------------------------------------------------- |
| `.cedar/gqlorm-schema.json`                    | Frontend model schema mapping model names to visible scalar fields |
| `.cedar/gqlorm/backend.ts`                     | Auto-generated GraphQL SDL and resolvers for the API side          |
| `.cedar/types/includes/web-gqlorm-models.d.ts` | TypeScript type declarations for the frontend query builder        |

## Frontend setup

Import the generated schema and call `configureGqlorm` once at app startup.
Typically you do this at the top of `App.tsx`:

```tsx title="web/src/App.tsx"
import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import schema from '../../.cedar/gqlorm-schema.json' with { type: 'json' }

configureGqlorm({ schema })
```

`configureGqlorm` is idempotent and safe to call multiple times. Passing `schema` lets the query builder know which scalar fields exist for each model, so `useLiveQuery((db) => db.todo.findMany())` requests every visible field instead of falling back to `id` only.

## Fetching data with `useLiveQuery`

`useLiveQuery` is the primary way to fetch data on the web side. Pass it a query function and it returns `{ data, loading, error }` just like a standard GraphQL query hook — but the query is annotated with `@live` so it automatically re-fetches when the underlying data changes.

```tsx title="web/src/components/LiveTodos/LiveTodos.tsx"
import { useLiveQuery } from '@cedarjs/gqlorm/react/useLiveQuery'

const LiveTodos = () => {
  const { data, loading, error } = useLiveQuery((db) => db.todo.findMany())

  if (loading) {
    return <div>Loading...</div>
  }
  if (error) {
    return <div>Error: {error.message}</div>
  }
  if (!data || data.length === 0) {
    return <div>No todos yet</div>
  }

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}

export default LiveTodos
```

### Supported query operations

The query function supports the same read operations you know from Prisma:

| Operation           | Description                             | Example                                               |
| :------------------ | :-------------------------------------- | :---------------------------------------------------- |
| `findMany`          | List all matching records               | `db.todo.findMany()`                                  |
| `findUnique`        | Fetch a single record by unique field   | `db.todo.findUnique({ where: { id: 1 } })`            |
| `findFirst`         | Fetch the first matching record         | `db.todo.findFirst({ where: { done: true } })`        |
| `findUniqueOrThrow` | Like `findUnique` but throws if missing | `db.todo.findUniqueOrThrow({ where: { id: 1 } })`     |
| `findFirstOrThrow`  | Like `findFirst` but throws if missing  | `db.todo.findFirstOrThrow({ where: { done: true } })` |

### Filtering and sorting

You can use `where`, `orderBy`, `take`, and `skip` just like Prisma:

```tsx
const { data } = useLiveQuery((db) =>
  db.post.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
)
```

Complex `where` clauses with `AND`, `OR`, and operators like `gt`, `contains`, etc. are also supported:

```tsx
const { data } = useLiveQuery((db) =>
  db.post.findMany({
    where: {
      AND: [{ published: true }, { createdAt: { gt: '2024-01-01' } }],
    },
  })
)
```

### Selecting specific fields

Without an explicit `select`, `useLiveQuery` requests every visible scalar field defined in the generated schema. To request only specific fields, pass a `select` object:

```tsx
const { data } = useLiveQuery((db) =>
  db.todo.findMany({
    select: { id: true, title: true },
  })
)
```

## Query builder API (advanced)

If you need more control — for example to build a one-off GraphQL document without React — you can use the query builder directly:

```ts
import { buildQuery, buildQueryFromFunction } from '@cedarjs/gqlorm'

// Build from model/operation/args
const graphqlQuery = buildQuery('todo', 'findMany', {
  where: { done: false },
})

// Build from a query function
const liveQuery = buildQueryFromFunction(
  (db) => db.todo.findUnique({ where: { id: 1 } }),
  { isLive: true }
)
```

Both return a `GraphQLQuery` object with `query` (string) and optional `variables`.

## Controlling schema visibility

gqlorm decides which models and fields are exposed through a small set of rules you control with documentation directives in `schema.prisma`.

### Hide a model

Add `/// @gqlorm hide` above the model to exclude it entirely:

```prisma title="api/db/schema.prisma"
/// @gqlorm hide
model InternalAuditLog {
  id        Int      @id @default(autoincrement())
  action    String
  createdAt DateTime @default(now())
}
```

### Hide or show a field

Add `/// @gqlorm hide` or `/// @gqlorm show` above a field:

```prisma title="api/db/schema.prisma"
model User {
  id       Int    @id @default(autoincrement())
  email    String @unique
  /// @gqlorm hide
  apiKey   String // stays hidden even though it doesn't match the heuristic
  /// @gqlorm show
  metadata Json  // explicitly exposed even if the heuristic would hide it
}
```

### Sensitive-field heuristics

By default, gqlorm hides any scalar field whose lowercased name contains one of these substrings:

`password`, `secret`, `token`, `hash`, `salt`, `apikey`, `secretkey`, `encryptionkey`, `privatekey`

If a field is auto-hidden, Cedar prints a warning at build time telling you how to confirm the hide (`/// @gqlorm hide`) or override it (`/// @gqlorm show`).

## Auth and multi-tenancy

When your Prisma schema includes a membership model (by default `Membership`) with `userId` and `organizationId` fields, gqlorm automatically scopes generated resolvers:

- **User scoping** — if a model has a `userId` field, `findMany` returns only rows belonging to `currentUser.id`, and `findUnique` verifies ownership before returning the record.
- **Organization scoping** — if a model has an `organizationId` field and a `Membership` model exists, `findMany` restricts results to organizations the current user belongs to.

The membership model itself is exempt from organization scoping (it is the source of membership data).

### Configuring membership fields

If your schema uses different names, configure them in `cedar.toml`:

```toml title="cedar.toml"
[experimental.gqlorm]
enabled = true
membershipModel = "TeamMember"
membershipUserField = "memberId"
membershipOrganizationField = "teamId"
```

## How the backend works

Cedar generates `.cedar/gqlorm/backend.ts` during the build. This file:

1. Exports a `schema` object (a `gql` document) with GraphQL types for each visible model and `Query` fields for `findMany` and `findUnique`.
2. Exports a `createGqlormResolvers(db)` factory that returns resolver functions wired to your Prisma client.

A Babel plugin injects the `db` import into `api/src/functions/graphql.ts` and passes it to `createGqlormResolvers`, so the generated resolvers are merged into your GraphQL schema automatically.

If you already have a manually-written SDL file that defines a type with the same name (e.g. `type Todo { ... }` in `api/src/graphql/todos.sdl.ts`), gqlorm skips generating that model to avoid duplicate-type errors.

## Limitations and known behavior

- **Read-only for now** — gqlorm currently generates queries (`findMany`, `findUnique`, `findFirst`, etc.). Mutations (`create`, `update`, `delete`) are not yet auto-generated.
- **Scalar and enum fields only** — relation fields are excluded from the generated schema. You can still use `include` in the query builder, but nested relations default to selecting `id` only unless the schema is extended.
- **Live queries require a stateful server** — because `@live` uses Server-Sent Events, you cannot use live queries on serverless deploy targets like Netlify or Vercel without additional infrastructure. See the [Realtime docs](realtime.md) for details.
- **Experimental flag required** — all gqlorm behavior is gated behind `experimental.gqlorm.enabled`.

## Summary

gqlorm lets you treat your GraphQL API like a Prisma client on the frontend. After enabling the experimental flag and calling `configureGqlorm`, you can write:

```tsx
const { data } = useLiveQuery((db) => db.todo.findMany())
```

and Cedar handles the rest: generating the GraphQL document, keeping it in sync with your schema, scoping it to the current user, and re-fetching automatically when data changes.
