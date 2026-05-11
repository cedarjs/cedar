---
description: gqlorm is a Prisma-inspired GraphQL query builder that lets you write type-safe queries without any GraphQL
---

# gqlorm

gqlorm is a Prisma-inspired GraphQL query builder. It provides a type-safe,
ORM-style API for writing GraphQL queries — no SDL, no service files, no
hand-written resolvers.

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

When `experimental.gqlorm.enabled` is set to `true`, gqlorm automatically
generates GraphQL types and resolvers for your Prisma models. On the frontend,
`useLiveQuery` replaces `useQuery` for read operations —
queries support live updates via the `@live` directive with no extra work.

## Configuration

Enable gqlorm in your `cedar.toml`:

```toml title="cedar.toml"
[experimental.gqlorm]
  enabled = true
```

### Organization scoping

If your app uses organizations, gqlorm can automatically scope queries to the
current user's organization:

```toml title="cedar.toml"
[experimental.gqlorm]
  enabled = true
  membershipModel = "Membership"             # default
  membershipUserField = "userId"             # default
  membershipOrganizationField = "organizationId"  # default
```

When a model has an `organizationId` field, gqlorm generates resolvers that
filter by the user's organization membership. When a model has a `userId`
field, resolvers are scoped to the current user.

## Setup

After enabling gqlorm in `cedar.toml`, the codegen runs automatically whenever
you start the dev server or build your app. It produces three artifacts:

| Artifact          | Path                                           | Purpose                                             |
| ----------------- | ---------------------------------------------- | --------------------------------------------------- |
| Model Schema      | `.cedar/gqlorm-schema.json`                    | Tells the frontend which fields exist on each model |
| Type Declarations | `.cedar/types/includes/web-gqlorm-models.d.ts` | TypeScript types for the ORM surface                |
| Backend Module    | `.cedar/gqlorm/backend.ts`                     | Auto-generated GraphQL SDL & resolvers              |

Then add the schema to your app. In your web entry point (usually `App.tsx`):

```tsx title="web/src/App.tsx"
import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import schema from '../../.cedar/gqlorm-schema.json' with { type: 'json' }

configureGqlorm({ schema })

const App = () => (
  // ...
)
```

The schema enables automatic field selection — when you don't specify a
`select` clause in your queries, gqlorm auto-selects all visible scalar fields
for you.

## Querying

### useLiveQuery (React)

The primary API for React components:

```tsx title="web/src/components/LiveTodos.tsx"
import { useLiveQuery } from '@cedarjs/gqlorm/react/useLiveQuery'

const LiveTodos = () => {
  const { data, loading, error } = useLiveQuery((db) => db.todo.findMany())

  if (loading) {
    return <div>Loading...</div>
  }
  if (error) {
    return <div>Error: {error.message}</div>
  }

  return (
    <div>
      {data?.map((todo) => (
        <article key={todo.id}>
          <h2>{todo.title}</h2>
          <p>{todo.body}</p>
        </article>
      ))}
    </div>
  )
}
```

`useLiveQuery` automatically uses the `@live` directive, so your component
re-renders automatically when data changes on the server.

### Filtering and field selection

```tsx
useLiveQuery((db) =>
  db.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, name: true },
  })
)
```

If you omit `select`, gqlorm uses the model schema to select all visible
scalar fields automatically.

### findUnique

```tsx
useLiveQuery((db) =>
  db.user.findUnique({
    where: { id: 1 },
    select: { id: true, name: true, email: true },
  })
)
```

### findFirst with logical operators

```tsx
useLiveQuery((db) =>
  db.post.findFirst({
    where: {
      AND: [
        { published: true },
        { createdAt: { gt: '2025-01-01T00:00:00.000Z' } },
      ],
    },
    select: { id: true, title: true },
  })
)
```

### orderBy, take, and skip

```tsx
useLiveQuery((db) =>
  db.post.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
)
```

### Direct query building (non-React)

If you need to build queries outside of React components:

```ts
import { buildQueryFromFunction } from '@cedarjs/gqlorm'

const { query, variables } = buildQueryFromFunction(
  (db) => db.user.findMany({ where: { isActive: true } }),
  { isLive: true }
)

// query: "query findManyUser($var0: Boolean) @live { users(where: { isActive: $var0 }) { id email name } }"
// variables: { var0: true }
```

## Visibility Directives

Control which models and fields gqlorm exposes by adding triple-slash comments
to your Prisma schema:

```prisma title="api/db/schema.prisma"
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  /// @gqlorm hide
  password  String
  name      String?
  posts     Post[]
}
```

| Directive                     | Effect                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| `/// @gqlorm hide` on a model | Entire model excluded from schema, types, and resolvers     |
| `/// @gqlorm hide` on a field | Field excluded with no warning                              |
| `/// @gqlorm show` on a field | Field explicitly included, even if its name looks sensitive |

### Automatic sensitivity detection

gqlorm automatically hides fields whose names match common sensitivity
patterns: `password`, `secret`, `token`, `hash`, `salt`, `apiKey`,
`secretKey`, `encryptionKey`, `privateKey`. When a field is auto-hidden, a
warning is printed during codegen. Add `/// @gqlorm show` to override, or
`/// @gqlorm hide` to silence the warning.

## How It Works

The pipeline has four phases:

1. **Codegen** (runs automatically on `yarn dev` and `yarn build`) — Parses
   your Prisma schema, applies visibility rules, and generates
   `gqlorm-schema.json` (frontend) plus `backend.ts` (GraphQL SDL +
   resolvers).

2. **Build-time injection** — A Babel plugin merges the generated SDL and
   resolvers into your GraphQL handler automatically.

3. **Frontend setup** — `configureGqlorm({ schema })` loads the model schema
   into the query builder for automatic field selection.

4. **Query time** — When `useLiveQuery((db) => db.todo.findMany(...))` runs,
   the call is captured via a Proxy, parsed into an AST, and converted into a
   standard GraphQL query string with parameterized variables.
