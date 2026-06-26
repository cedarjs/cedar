# pnpm Peer Dependency Resolution — Why Shared Singletons Get Duplicated

## The Problem

When running `cedar g types` (or `cedar g dbAuth` which internally runs type
generation), you can hit this error with pnpm:

```
Error: Cannot use GraphQLObjectType "Cedar" from another module or realm.

Ensure that there is only one instance of "graphql" in the node_modules
directory.
```

The stack trace shows the calling path:

```
at instanceOf (node_modules/.pnpm/graphql@16.14.2/node_modules/graphql/jsutils/instanceOf.js)
at isObjectType (node_modules/.pnpm/graphql@16.14.2/node_modules/graphql/type/definition.js)
at mapSchema (node_modules/.pnpm/@graphql-tools+utils@11.1.0_graphql@16.14.2/)
at addResolversToSchema (node_modules/.pnpm/@graphql-tools+schema@10.0.33_graphql@16.13.2/)
```

`instanceOf` and `isObjectType` are from the **same** graphql copy (`16.14.2`),
as expected for co-resident functions. The cross-version collision is in the
**data flow**: `addResolversToSchema` (resolved with graphql@16.13.2) calls
`mapSchema` (resolved with graphql@16.14.2) and passes a `GraphQLObjectType`
instance constructed by 16.13.2's constructors. When `instanceOf` checks
`value instanceof GraphQLObjectType` using 16.14.2's `GraphQLObjectType`
constructor against an object whose prototype chain connects to 16.13.2's
constructor, `instanceof` returns `false`.

## Why This Happens

### pnpm Resolves Peer Dependencies Per Chain, Not Globally

pnpm does not globally deduplicate peer dependencies. Instead, it resolves them
independently for each dependency chain in the tree. A workspace package's
subtree gets its own resolution of peer dependencies based on what's available
in **its ancestor chain** — not what's available globally.

### Peer Deps Don't Propagate Downward

When a package has `graphql` as a **peer** dependency (not a regular
dependency), packages deeper in that package's subtree do NOT see graphql as
"provided."

Example:

```
web/                         (workspace, no graphql dep)
  └─ @cedarjs/web            (peerDep: graphql@16.13.2 — only *requests* it)
       ├─ @apollo/client     (peerDep: graphql — looks up, finds no *regular* dep → resolves independently)
       ├─ graphql-ws         (same)
       └─ @graphql-tools/*   (same)
```

`@cedarjs/web` has graphql as a peer dep — it says "I need this, consumer
provides it." But when `@apollo/client` (a regular dep of `@cedarjs/web`) also
needs graphql as a peer dep, pnpm looks up the chain and sees that
`@cedarjs/web` only _requests_ graphql, it doesn't _provide_ it (no regular
dep). So pnpm keeps looking up. If no ancestor in the chain has graphql as a
regular dep, pnpm resolves it independently, potentially picking a different
version than another chain.

### Different Chains = Different Copies, Colliding at Runtime

This isn't a type check across different workspace packages — it's a collision
inside a **single Node.js process** that loads packages whose transitive deps
were resolved in different pnpm chains.

Here is the concrete path through the Cedar CLI that triggers the error:

1. `cedar g types` loads the project's GraphQL SDL files using
   `@graphql-tools/load` and `@graphql-tools/schema` to build a merged schema
2. Both of those packages come from `@cedarjs/internal`'s dependency tree
3. Internally, `@graphql-tools/schema@10.0.33` depends on
   `@graphql-tools/merge@9.1.9` and `@graphql-tools/utils@11.1.0` — these
   resolve in the `@cedarjs/graphql-server` chain where graphql@16.13.2 is a
   **regular** dep, so `@graphql-tools/schema` gets graphql@16.13.2
4. Separately, `@graphql-tools/utils@11.1.0` also appears through
   `@graphql-tools/merge` / `@graphql-tools/executor` in a different chain
   (e.g., via `graphql-yoga` within `@cedarjs/graphql-server`, or via
   `@graphql-tools/load` within `@cedarjs/internal`) — this chain's nearest
   provider may be graphql@16.14.2 instead
5. Now within the same process, `addResolversToSchema` (from the
   graphql@16.13.2 chain, via `@graphql-tools/schema@10.0.33`) receives a
   schema containing `GraphQLObjectType` instances constructed by
   graphql@16.13.2's constructors
6. It passes that schema to `mapSchema` (from the graphql@16.14.2 chain, via
   `@graphql-tools/utils@11.1.0`), which internally calls `isObjectType(type)`
7. `isObjectType` does `(0, instanceOf)(type, GraphQLObjectType)` — both
   `instanceOf` and `GraphQLObjectType` are from graphql@16.14.2
8. `instanceOf` checks `type instanceof GraphQLObjectType` — but `type`'s
   prototype chain connects to graphql@16.13.2's `GraphQLObjectType.prototype`,
   not 16.14.2's → `instanceof` returns `false` → error

The workspaces (`api/`, `web/`) don't interact directly. The collision happens
because `@cedarjs/internal` and `@cedarjs/graphql-server` both end up as
resolved dependencies of the CLI process, and their transitive dep chains were
resolved independently by pnpm.

### Overlapping Peer Dep Ranges Don't Help

Peer dep ranges can overlap (`^16.13.2` includes `16.14.2`) and pnpm will still
create duplicates if the resolution chains are independent. The issue isn't
version incompatibility — it's that pnpm processes each chain separately and
never reconciles them globally.

### Conceptual Illustration

If two workspace packages declare different versions of the same peer-dep
singleton, pnpm creates N copies of any shared dependency that has it as a peer
dep — one per version:

```
Workspace A (graphql@16.13.2)
  └─ shared-lib (peerDep: graphql) → resolved with graphql@16.13.2

Workspace B (graphql@17.0.1)
  └─ shared-lib (peerDep: graphql) → resolved with graphql@17.0.1
```

Result in `.pnpm/`:

```
shared-lib@1.0.0_graphql@16.13.2   ← copy for Workspace A
shared-lib@1.0.0_graphql@17.0.1    ← copy for Workspace B
```

Even though the peer dep range on `shared-lib` allows both versions (e.g.
`^14.0.0 || ^15.0.0 || ^16.0.0 || ^17.0.0`), pnpm never reconciles them. Each
workspace chain resolves independently, and the duplicate persists.

## What We Did to Fix It

### 1. Skip `project:copy` for pnpm

The `project:copy` step (`tasks/framework-tools/frameworkFilesToProject.mjs`)
deletes and re-copies all framework packages from source into `node_modules/` as
flat directories. For pnpm, this destroys the `.pnpm` store symlinks and
replaces them with plain directories that lack inner `node_modules/` (where pnpm
stores the package's own dependencies).

`project:tarsync` (step 2) already installs framework packages correctly from
built tarballs, so `project:copy` is redundant when tarsync has run.

### 2. Added `graphql: 16.13.2` to pnpm overrides

In `tasks/framework-tools/tarsync/lib.mts`, we pin graphql in
`pnpm-workspace.yaml`:

```yaml
overrides:
  graphql: '16.13.2'
```

This forces all dependency chains to resolve to the same version, regardless of
what each chain's nearest provider would otherwise pick.

### 3. Added missing direct deps for pnpm

Dependencies that are hoisted by yarn (like `graphql-tag`, `react-hook-form`,
`@prisma/client`) are added as explicit regular deps of their workspace packages
in the tarsync code, so pnpm's per-chain resolution finds them.

## How to Avoid This in Framework Packages

When a framework package has a singleton (`graphql`, `react`, `react-dom`) as a
peer dependency, and packages in its subtree also need it as a peer dep, ensure
the **consumer workspace** (`web/package.json` or `api/package.json`) has it as
a regular dependency so pnpm's chain resolution finds a provider.

The framework package itself should keep the peer dep (per npm's guidance for
singletons). The workspace is where the anchor belongs.
