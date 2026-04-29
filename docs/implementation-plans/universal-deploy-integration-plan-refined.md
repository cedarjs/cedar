# Refined Plan: Cedar + Universal Deploy Integration

## Summary

Adopting
[Universal Deploy](https://github.com/universal-deploy/universal-deploy)
(UD) in Cedar requires moving from the current split runtime model —
Vite for web, Fastify/Lambda for API — to a unified Fetch-native model
where:

- Cedar's primary server contract is
  `handleRequest(request: Request, ctx: CedarRequestContext): Response`
- Vite is the full-stack dev host
- Cedar exposes explicit server entries and route metadata for providers
- SSR becomes just another server entry, not a special legacy runtime

The `handleRequest()` contract is Phase 1 because everything else depends on
it. The context object carries only Cedar-specific enrichments —
`headers` and `url` already live on `Request` and must not be
duplicated.

Cedar uses two distinct handler shapes: `handleRequest(request, ctx)` as the
authoring surface for app developers, and `export default { fetch }` as
the WinterTC-compatible deployment artifact that Cedar's build tooling
emits. These are intentionally different — see Guiding Principle 6 for
details.

GraphQL via Yoga is a quick win: Yoga's `fetch()` handler is already
nearly the target shape, so the migration is mostly wiring.

Read more about framework-specific integration here:
https://github.com/universal-deploy/universal-deploy/blob/main/docs/framework-developers.md

## Goals

- Adopt a Cedar-native Fetch-style server contract for backend handlers
- Preserve a Cedar-specific request context carrying only framework
  enrichments (cookies, params, query, auth state)
- Formalize middleware as composable functions over the Fetch-native
  handler contract
- Replace Lambda-first backend assumptions with a portable runtime model
- Move Cedar toward a single-port, Vite-centric full-stack dev model
- Formalize Cedar route metadata and server entries for UD registration
- Establish a clean adapter story for Node, Vercel, Netlify, and
  Cloudflare
- Rebuild SSR on top of the new runtime model

## Non-Goals

- Preserving the current AWS Lambda handler shape as Cedar's primary
  contract
- Preserving the current Express-based SSR runtime as foundational
  architecture
- Implementing full UD support before Cedar has standardized its own
  runtime contracts

## Current State

Today Cedar uses different runtime models on the web and API sides.

### Web Side

- Vite is used for frontend dev server behavior
- SPA routes are defined in `Routes.tsx`
- `Routes.tsx` is a Cedar routing DSL, not a normal React component
- In SPA mode, Vite proxies API requests to the separate API server

### API Side

- Local dev uses a separate backend runtime based on Fastify
- Backend functions are built and served outside the Vite runtime
- API functions are fundamentally modeled as AWS Lambda-style handlers
- Fastify acts largely as an adapter that maps HTTP requests to
  Lambda-shaped function invocations
- GraphQL is closer to Fetch internally because Yoga already exposes
  `fetch()` semantics

### Middleware

- Cedar already has a middleware model: `MiddlewareRequest`,
  `MiddlewareResponse`, chaining, route-pattern grouping, and
  short-circuit support
- Middleware handles cookies, auth state, redirects, and header
  mutation
- Auth providers (dbAuth, Supabase) implement middleware that sets
  `serverAuthState` on the request
- Middleware is registered in `entry.server.ts` via
  `registerMiddleware()`
- The current model is tightly coupled to `MiddlewareRequest` (extends
  `Request`) and `MiddlewareResponse` (a builder class)

### Routing

- Frontend route metadata is explicit through `Routes.tsx`
- Backend routes are more implicit:
  - GraphQL
  - auth endpoints
  - filesystem-discovered functions
  - app-defined internal method/sub-route dispatch

### SSR

- Cedar has experimental streaming SSR/RSC support
- The current implementation is old, custom, and lightly maintained
- It should not be treated as a stable foundation for UD adoption

## Guiding Principles

### 1. Cedar Owns Its Runtime Contract

UD should integrate with Cedar after Cedar standardizes its own
request handling. Cedar should not directly adopt Cloudflare, Netlify,
or Vercel handler signatures as its primary framework contract.

### 2. Fetch Is the Center of Gravity

The Cedar core runtime should be modeled as:

- input: `Request`
- output: `Response`

Adapters translate that core contract to provider-specific entry
formats. See the Adapter Pattern section below.

### 3. CedarRequestContext Carries Only Enrichments

`Request` already has `headers` and `url`. The context must not
duplicate them. `CedarRequestContext` carries only what Cedar adds on
top: parsed cookies, route params, query data, and auth state.

### 4. Middleware Is Composable Over the Handler Contract

Cross-cutting concerns (auth, cookies, CORS, logging) are modeled as
composable functions over the same `(Request, CedarRequestContext)`
signature that handlers use.

### 5. SSR Comes After Runtime Modernization

SSR should be rebuilt on top of the new Fetch-native core, not ported
forward as a special case from the current experimental implementation.

### 6. Two Distinct Handler Surfaces

Cedar maintains two distinct handler shapes at two different abstraction
layers:

- **Authoring surface** — `handleRequest(request, ctx)`, used by Cedar app
  developers and middleware authors. The `ctx` parameter carries
  Cedar-specific enrichments no platform provides natively.
- **Deployment artifact** — `export default { fetch(request) }`, the
  WinterTC-compatible shape Cedar's build tooling emits for provider
  consumption.

The transformation between these layers is Cedar's responsibility. App
developers never write `export default { fetch }`; Cedar generates it.
Provider integrators never see `CedarRequestContext`; Cedar populates it
internally before calling `handleRequest()`.

## The Handler Contract

```ts
interface CedarRequestContext {
  cookies: ReadonlyMap<string, string>
  params: Record<string, string>
  query: URLSearchParams
  serverAuthState?: ServerAuthState
}

export async function handleRequest(
  request: Request,
  ctx: CedarRequestContext
): Promise<Response>
```

### Why `headers` and `url` Are Not in the Context

The original plan included `headers: Headers` and `url: URL` in the
context. This creates ambiguity: if a middleware mutates `ctx.headers`,
does the `Request`'s headers change? Which is the source of truth?

The answer is simple: `request.headers` and `new URL(request.url)` are
the source of truth. The context carries only Cedar-specific
enrichments that do not exist on `Request`.

### Why These Fields (and Why `cookies` Is Different)

The context includes fields that are derived, parsed, or mutable
enrichments over the raw `Request`, not direct copies:

- `cookies` — Though cookies are transmitted via the `Cookie` HTTP
  header, `ReadonlyMap<string, string>` is a parsed, read-only map of
  inbound cookies keyed by name. The `ReadonlyMap` interface gives
  handlers ergonomic `.get()` and `.has()` access consistent with how
  `ctx.query` (a `URLSearchParams`) works, while making it structurally
  impossible to mutate the field — response-side cookies belong in
  `Set-Cookie` headers on the returned `Response`, not in the context.
- `params` — Cedar parses URL path parameters from the matched route
  pattern. `Request.url` contains the raw URL; extracting params requires
  route matching logic that belongs in Cedar's router, not on the
  `Request` object.
- `query` — `URLSearchParams` parsed from the request URL. This is
  identical to `new URL(request.url).searchParams` and is included in
  the context purely for convenience so handlers do not have to
  construct a `URL` object themselves. Multi-value params are
  accessible via `ctx.query.getAll(key)`.
- `serverAuthState` — Cedar computes this during auth middleware
  execution. It does not exist on `Request` at all; it is purely a
  Cedar concept derived from auth cookies or headers.

### What Is Intentionally Excluded

- provider-specific `env`
- provider-specific `ctx`
- `waitUntil`
- Vite dev server references
- arbitrary platform bindings

Those may be introduced later through adapter internals or a future
Cedar runtime abstraction, but they should not block the initial
contract migration.

### Authoring Surface vs. Deployment Artifact

Cedar uses two distinct handler shapes at two different abstraction
layers. These are not in conflict — they serve different audiences.

**The authoring surface** is what Cedar app developers write:

```ts
// api/src/functions/myFunction.ts
export async function handleRequest(
  request: Request,
  ctx: CedarRequestContext
): Promise<Response> {
  const { params, query, cookies, serverAuthState } = ctx
  return Response.json({ message: 'Hello' })
}
```

**The deployment artifact** is what Cedar's build tooling emits for
WinterTC-compatible runtimes — app developers never write this directly:

```ts
// Generated by Cedar's build tooling
export default {
  async fetch(request: Request): Promise<Response> {
    const ctx = await buildCedarContext(request)
    return handleRequest(request, ctx)
  },
}
```

These are intentionally different because:

- `CedarRequestContext` carries enrichments (parsed cookies, route
  params, auth state) that no platform provides natively and that do
  not belong on a standard WinterTC `Request` object.
- The deployment artifact conforms to the WinterTC standard so Cedar
  outputs are consumable by Cloudflare Workers, Deno Deploy, Bun,
  Netlify Edge Functions, and any other WinterTC-compliant runtime.
- The transformation between layers is Cedar's responsibility, not the
  app developer's. Cedar generates the right artifact for the target
  platform.

**Provider developers and framework integrators interact with the
deployment artifact** (`export default { fetch }`). **Cedar app
developers interact with `handleRequest(request, ctx)`**. Adapters (see The
Adapter Pattern below) handle the translation in both directions.

## The Middleware Model

Cedar already has middleware for cookies, auth, redirects, and header
mutation. The Fetch-native model formalizes middleware as composable
functions over the handler contract.

### Middleware Signature

```ts
type CedarMiddleware = (
  request: Request,
  ctx: CedarRequestContext,
  next: () => Promise<Response>
) => Promise<Response>
```

This is similar to how Hono and other Fetch-native frameworks model
middleware. The `next()` function calls the next middleware in the
chain (or the final handler).

### Composition

Middleware composes by wrapping:

```ts
function compose(
  middlewares: CedarMiddleware[],
  handler: CedarHandler
): CedarHandler {
  return middlewares.reduceRight((next, mw) => {
    return (req, ctx) => mw(req, ctx, () => next(req, ctx))
  }, handler)
}
```

### Migration From Current Model

The current `MiddlewareRequest`/`MiddlewareResponse` model maps onto
this:

- `MiddlewareRequest.cookies` → `ctx.cookies`
- `MiddlewareRequest.serverAuthState` → `ctx.serverAuthState`
- `MiddlewareResponse.next()` → `next()`
- `MiddlewareResponse.shortCircuit()` → return a `Response` directly
  without calling `next()`
- `MiddlewareResponse.redirect()` → return
  `new Response(null, { status: 302, headers: { Location: url } })`

Existing auth middleware (dbAuth, Supabase) will need thin wrappers
during the transition. These wrappers translate between the old
`MiddlewareRequest`/`MiddlewareResponse` signatures and the new
`CedarMiddleware` signature. The wrapping is mechanical.

### Route-Scoped Middleware

Cedar already supports route-pattern grouping for middleware. This
continues to work: middleware is registered with a pattern, and the
router applies it only to matching requests.

## The Adapter Pattern

Cedar owns **zero** deployment adapters. This is a deliberate division
of responsibility between Cedar and Universal Deploy.

### Who Owns What

**Cedar's responsibility:**

1. Emit WinterTC-compatible deployment artifacts — modules that export
   a `Fetchable` object matching UD's interface:
   ```ts
   // Generated by Cedar's build tooling
   export default {
     async fetch(request: Request): Promise<Response> {
       const ctx = await buildCedarContext(request)
       return handleRequest(request, ctx)
     },
   }
   ```
2. Register each server entry with UD's store:

   ```ts
   import { addEntry } from '@universal-deploy/store'

   addEntry({
     id: './dist/functions/myFunction.js',
     route: '/api/myFunction',
     method: ['GET', 'POST'],
   })
   ```

**UD's responsibility:**

UD provides adapters that read from its store and handle all
deployment-target-specific wiring:

- `@universal-deploy/node` — wraps store entries with `srvx`
  (a WinterTC-compatible Node.js HTTP server) and `sirv` for static
  assets. Handles baremetal and VPS self-hosting.
- `@universal-deploy/adapter-netlify` — wires Cedar's entries into
  Netlify's deployment pipeline via `@netlify/vite-plugin`.
- Additional UD adapters handle Vercel, Cloudflare, and other
  providers as they are developed.

Cedar does not know about `http.IncomingMessage`, `VercelRequest`,
`HandlerEvent`, or any other provider-specific request type. That
knowledge lives entirely in UD's adapters.

### Cedar's Only Internal Adaptation

The one "adaptation" Cedar does perform is internal and invisible to
deployment: `buildCedarContext(request)` enriches a standard `Request`
into a `CedarRequestContext` before calling `handleRequest()`. This is not a
deployment adapter — it is Cedar's request enrichment step, and it
runs inside every `fetch()` wrapper Cedar emits.

### What This Means in Practice

A Cedar app's production deployment looks like this:

```
Cedar build tooling emits:    export default { fetch }     (Fetchable, per entry)
Cedar registers with:         @universal-deploy/store      (addEntry)
UD adapter consumes:          store entries                (e.g. adapter-node, adapter-netlify)
Platform receives:            provider-specific artifact   (UD's problem, not Cedar's)
```

Cedar's surface ends at the `Fetchable` export. Everything after that
is UD's domain.

## Target Architecture

### Development

- Vite is the externally visible full-stack dev host
- Cedar registers server entries into the Vite runtime
- Requests for pages, GraphQL, auth, and functions are dispatched
  without a proxy hop to a separate API server
- Frontend and backend updates share one module graph and one watcher

### Production

- Cedar emits WinterTC-compatible `Fetchable` entries and registers
  them with `@universal-deploy/store`
- UD's adapters consume the store entries and produce
  deployment-target-specific artifacts
- Cedar owns zero deployment adapters — Node, Netlify, Vercel,
  Cloudflare, and any future targets are UD's responsibility
- Nginx or another reverse proxy can sit in front for self-hosting;
  the Node runtime is provided by `@universal-deploy/node`

## Implementation Phases

### Phase Dependency Graph

Phases are not strictly sequential. After Phase 1 completes:

- **Phase 2** (route discovery) and **Phase 3** (UD adapter adoption)
  can proceed **in parallel** — they have no dependency on each other,
  only on Phase 1
- **Phase 4** depends on Phases 2 and 3
- **Phase 5** depends on Phase 4
- **Phase 6** depends on Phase 5
- **Phase 7** (SSR rebuild) can begin **design work during Phases
  5–6** — the handler contract and middleware model are already
  stable after Phase 1
- **Phase 8** depends on Phases 6 and 7

```
Phase 1 ──┬── Phase 2 ──┐
          │             ├── Phase 4 ── Phase 5 ── Phase 6 ──┐
          └── Phase 3 ──┘                                   ├── Phase 8
                   Phase 7 (design: Phase 5–6) ─────────────┘
```

---

### Phase 1: Adopt Fetch-Native Cedar Handlers

**Effort: L (Large)**

This is the foundational phase. Everything else depends on it.

#### Goal

Make this Cedar's primary backend handler contract:

```ts
export async function handleRequest(
  request: Request,
  ctx: CedarRequestContext
): Promise<Response>
```

#### Work

- Define `CedarRequestContext` in a shared framework package
- Add a Fetch-native handler loader/executor for backend functions
- Formalize request normalization: cookie parsing, query parsing,
  param extraction, auth state hydration
- **Formalize the middleware model** (see Middleware Model section
  above): define `CedarMiddleware` type, implement `compose`, build
  thin wrappers for existing auth middleware
- Migrate or wrap GraphQL so Cedar treats it as a Fetch-native entry
- **Compatibility shim**: introduce `wrapLegacyHandler` so existing
  legacy-shaped handlers continue to work during the transition (the
  shim wraps the old `(event, context) => result` shape into
  `(Request, CedarRequestContext) => Response`)
- Establish test coverage for:
  - direct function invocation
  - GraphQL requests
  - auth/cookie handling through new middleware model
  - query parsing
  - response headers and status codes
  - the legacy handler compatibility shim

#### GraphQL Quick Win

Yoga's `fetch()` handler is already nearly the target shape. The
GraphQL migration is mostly wiring:

1. Wrap Yoga's `fetch` handler in Cedar's handler contract
2. Ensure `CedarRequestContext` flows through to GraphQL resolvers
   via the existing Yoga context mechanism
   (`context: ({ request }) => ...`)
3. Remove the Fastify-specific GraphQL mounting code

This should be one of the first things done in Phase 1 because it
validates the handler contract against a real, complex entry point.

#### GraphQL Transitional Context Bridge

During the Phase 1 migration, Cedar's GraphQL execution path may still
need to provide legacy-shaped GraphQL context fields to existing Yoga
plugins and auth integrations. In practice, this means Cedar can be
Fetch-native at the handler boundary while still passing these
transitional fields into Yoga context:

- `request: Request`
- `cedarContext: CedarRequestContext`
- `event: APIGatewayProxyEvent` (legacy bridge)
- `requestContext: LambdaContext | undefined` (legacy bridge)

This bridge is transitional. It exists to keep current GraphQL auth,
logging, and context plugins working while Cedar moves the GraphQL
stack toward Fetch-native shapes internally.

The important distinction is:

- Cedar's public server-entry contract should be `Request -> Response`
- GraphQL's internal plugin context may temporarily carry both
  Fetch-native and legacy fields
- New Cedar GraphQL code should prefer `request` and `cedarContext`
  over `event` and `requestContext`

#### GraphQL Plugin Migration Path

GraphQL plugin migration should happen in explicit steps:

1. Introduce Fetch-native fields into GraphQL context:
   - `request`
   - `cedarContext`
   - Status: Completed
2. Teach Cedar-owned Yoga plugins to prefer Fetch-native fields first,
   while still falling back to legacy fields when needed
   - Status: In progress
   - Completed so far:
     - `useRedwoodAuthContext`
     - `useRedwoodLogger`
   - Remaining Cedar-owned plugins to review and migrate where
     applicable:
     - `useArmor`
     - `useRedwoodDirective`
     - `useRedwoodError`
     - `useRedwoodGlobalContextSetter`
     - `useRedwoodOpenTelemetry`
     - `useRedwoodPopulateContext`
     - `useRedwoodTrustedDocuments`
3. Deprecate direct dependence on:
   - `event`
   - `requestContext`
   - Status: Not started
4. Remove legacy GraphQL context fields only after Cedar-owned plugins
   and supported auth integrations no longer require them
   - Status: Not started

This avoids a flag day for GraphQL internals while still keeping the
overall Cedar runtime migration pointed at the correct target
architecture.

#### Compatibility Shim

To avoid a flag day for existing apps, Phase 1 includes a shim:

```ts
function wrapLegacyHandler(legacyHandler: LegacyHandler): CedarHandler {
  return async (request, ctx) => {
    const event = await requestToLegacyEvent(request, ctx)
    const result = await legacyHandler(event, legacyContext)
    return legacyResultToResponse(result)
  }
}
```

The shim is a migration aid, not a permanent feature. It lets existing
legacy-shaped function handlers work while app developers migrate to
the new shape.

#### Deliverables

- Stable Fetch-native Cedar handler contract
- `CedarMiddleware` type and composition utilities
- Wrappers for existing auth middleware (dbAuth, Supabase)
- Legacy handler compatibility shim (`wrapLegacyHandler`)
- Function execution that no longer depends on Lambda shape internally
- GraphQL running as a Fetch-native Cedar server entry
- Transitional GraphQL context bridge that exposes `request` and
  `cedarContext` while preserving `event` and `requestContext` for
  compatibility
- First-stage GraphQL plugin migration where Cedar-owned plugins can
  begin preferring Fetch-native context while still supporting legacy
  fields

#### Exit Criteria

- Cedar functions can be authored and executed with
  `Request → Response`
- GraphQL is treated as a Fetch-native Cedar server entry
- Existing legacy-shaped handlers work via the compatibility shim
- Cedar-owned GraphQL plugins can read Fetch-native context fields
  (`request`, `cedarContext`) and prefer them over legacy fields
  where migrated
- Remaining Cedar-owned GraphQL plugins are explicitly identified for
  follow-up migration work
- Middleware composes over the new handler contract
- Fastify is no longer the defining contract for Cedar backend
  execution

#### Developer Experience Note

After Phase 1 but before Phase 4, the **two-port dev model persists**
(`8910` web + `8911` API). The handler contract changes are internal
to the framework. Most app developers will not notice any difference
unless they author custom function handlers, in which case the
compatibility shim covers them.

**User-facing impact**: Low. Internal refactor with compatibility shim.

---

### Phase 2: Formalize Backend Route Discovery

**Effort: M (Medium)**

Can proceed **in parallel with Phase 3** after Phase 1.

#### Goal

Turn Cedar's implicit backend routing model into explicit route
metadata.

#### One Entry vs. Many Entries

**Recommendation**: start with a **single dispatcher entry**. This
matches Cedar's current model (one Lambda function dispatching to
sub-routes) and is simpler for initial UD integration. The route
metadata still enumerates all individual routes — the dispatcher is
the entry point, and the manifest describes what it handles.

Later, for providers that benefit from per-route entries (e.g.,
Cloudflare Workers with per-route isolates), the manifest can be used
to generate split entries. But the single-dispatcher model is the
default.

#### Work

- Define a normalized backend route record type:
  ```ts
  interface CedarRouteRecord {
    path: string
    methods: string[]
    type: 'graphql' | 'auth' | 'function' | 'health'
    entry: string // module path
  }
  ```
- Enumerate and register:
  - GraphQL
  - auth endpoints
  - filesystem-discovered functions
  - health/readiness routes
- Formalize how function route names map to URL paths and methods
- Align frontend route metadata from `Routes.tsx` with backend route
  metadata enough to produce one coherent routing model
- Build manifest generation (JSON output for UD consumption)

#### Deliverables

- Explicit backend route manifest generation
- One source of truth for backend route shape
- Single-dispatcher entry as the default, with manifest granularity
  for future per-route splitting

#### Exit Criteria

- Cedar can list all provider-relevant backend routes without relying
  on framework-specific server wiring
- Route manifest is machine-readable and sufficient for UD

**User-facing impact**: None. Internal route discovery formalization.

---

### Phase 3: Adopt UD's Deployment Adapters

**Effort: M (Medium)**

Can proceed **in parallel with Phase 2** after Phase 1.

#### Goal

Replace Fastify as Cedar's production runtime by emitting
WinterTC-compatible `Fetchable` entries that UD adapters can consume,
and providing a working srvx-based API server as the immediate
Fastify replacement. Cedar builds no adapters of its own.

Phase 3 delivers the runtime dispatch infrastructure and the virtual
module wiring that UD adapters need. Full end-to-end validation using
`@universal-deploy/node` proper is deferred to Phase 4, because
`@universal-deploy/node` requires Cedar's API to be built with Vite —
which does not happen until Phase 4.

#### Work

- Implement `buildCedarDispatcher(options)` in `@cedarjs/api-server`:
  discovers API functions from `api/dist/functions/` at runtime,
  builds a rou3 router and per-function `Fetchable` map, and returns a
  single dispatch `Fetchable` together with the `EntryMeta[]` needed to
  register each function with the UD store
- Implement `createUDServer(options)` in `@cedarjs/api-server`: wraps
  `buildCedarDispatcher` in an srvx HTTP server and calls `addEntry()`
  for each discovered function for UD store introspection
- Expose `cedar-ud-server` binary and `cedar serve api --ud` CLI flag,
  both delegating to `createUDServer` instead of Fastify

#### Why `@universal-deploy/node` proper is a Phase 4 concern

`@universal-deploy/node` is designed to be consumed through a Vite
build pipeline. Its server entry (`@universal-deploy/node/serve`)
starts srvx by statically importing the catch-all handler as a virtual
module:

```ts
// @universal-deploy/node/serve (simplified)
import userServerEntry from 'virtual:ud:catch-all'
// srvx then calls userServerEntry.fetch for every request
```

`virtual:ud:catch-all` is not a real module path — it only resolves
during a Vite build. Cedar's API side is currently compiled with
Babel/esbuild, not Vite, so `@universal-deploy/node/serve` cannot be
imported or run for `cedar serve api` today.

Phase 3's `createUDServer` is the practical equivalent for the
current build pipeline: it uses the same srvx server and produces
identical runtime behaviour, discovering and loading functions from
the already-compiled `api/dist/functions/` at startup rather than
through a Vite virtual module graph.

#### How to wire in `@universal-deploy/node` once Phase 4 is done

When Phase 4 gives Cedar a Vite-based API server build, the hookup is
straightforward:

1. Introduce `cedarUniversalDeployPlugin()` in `@cedarjs/vite` and add
   it to the **API server Vite build config** (not the web client
   config — the plugin resolves API-server virtual modules that have
   no relevance to the browser bundle)
2. Wire `virtual:ud:catch-all` → `virtual:cedar-api` inside the plugin
   so that `@universal-deploy/node/serve` can import Cedar's aggregate
   Fetchable at build time
3. Add `node()` from `@universal-deploy/node/vite` to the same
   **API server Vite build config**
4. `cedar serve` runs the Vite-built output directly

**Naming caution for Phase 4**: Vite calls its Node.js server build
environment **"SSR"** regardless of whether it renders HTML. This is
confusing in Cedar's context, where "SSR" specifically means React
streaming / RSC. The Vite "SSR environment" output that
`@universal-deploy/node` produces is purely the API server entry — it
has no connection to Cedar's HTML SSR feature. Do not add `node()` to
any Vite config that also builds the HTML SSR entry.

#### Deliverables

- `buildCedarDispatcher(options)` — runtime function discovery and
  Fetchable dispatch, in `@cedarjs/api-server`
- `createUDServer(options)` — srvx-based API server wrapping the
  dispatcher, in `@cedarjs/api-server`
- `cedar-ud-server` binary and `cedar serve api --ud` flag — serve
  the Cedar API without Fastify

#### Exit Criteria

- Cedar can run in production on Node without Fastify via
  `cedar serve api --ud` or the `cedar-ud-server` binary

#### Temporary scaffolding introduced in Phase 3

Several pieces of Phase 3 are deliberate scaffolding — they make Cedar
work without Fastify today while the Vite-based build pipeline that
`@universal-deploy/node` requires does not yet exist. They should be
removed or replaced in the phases noted below.

**Remove / replace in Phase 4:**

- `createUDServer` (`packages/api-server/src/createUDServer.ts`) —
  the srvx runtime stand-in for `@universal-deploy/node`. Phase 4
  replaces it with a Vite-built server entry produced by
  `@universal-deploy/node/vite`'s `node()` plugin. Once `cedar serve`
  runs that built output, `createUDServer` has no remaining purpose
  and should be deleted.
- `udBin.ts` / `udCLIConfig.ts` / the `cedar-ud-server` binary —
  these exist solely to invoke `createUDServer`. They go away together
  with it in Phase 4, unless a non-Vite standalone serve mode is
  deliberately kept.
- `cedar serve api --ud` CLI flag (`packages/cli/src/commands/serve.ts`)
  — the temporary bridge that routes to `createUDServer` instead of
  Fastify. Phase 4 should make UD serving the default and remove the
  flag entirely.
- `buildCedarDispatcher` (`packages/api-server/src/udDispatcher.ts`) —
  the runtime function-discovery function (uses `fast-glob` to scan
  `api/dist/functions/` at startup). In Phase 4 the API is built and
  bundled by Vite, so runtime discovery is no longer needed; the
  function can be deleted. If a non-Vite standalone mode is kept,
  `buildCedarDispatcher` can be retained for that path only.

**User-facing impact**: None for most developers. Self-hosting users
can opt in to the Fastify-free srvx server via `cedar serve api --ud`
or the `cedar-ud-server` binary. Full `@universal-deploy/node`
end-to-end arrives in Phase 4.

---

### Phase 4: Move Dev to Vite-Centric Full-Stack Runtime

**Effort: XL (Extra Large)**

Depends on Phases 2 and 3.

#### Goal

Introduce a unified `cedar dev` command that runs both web and API sides
from a single CLI entrypoint, while preserving a compatibility path for
existing apps that depend on custom Fastify server setup. The dev
runtime still uses two ports (`8910` web + `8911` API) in this phase;
moving to a single visible port is Phase 5 work.

#### Work

- Introduce `cedar-unified-dev` as the default dev command: one CLI
  process that orchestrates the web Vite dev server and the API dev
  server together, eliminating the need for developers to run two
  separate terminals or commands
- Keep the existing proxy model (`8910 → proxy → 8911`) for the default
  Cedar runtime path in this phase
- Move API code compilation into the Vite module graph (via Vite SSR +
  Babel transform) so API functions get true HMR without nodemon
  restarts
- Ensure server-side file watching and invalidation work for backend
  entries
- Preserve strong DX for browser requests, direct `curl` requests,
  and GraphQL tooling (e.g. GraphiQL must still work)
- Preserve a compatibility path for apps that use `api/src/server.{ts,js}`,
  `configureFastify`, `configureApiServer`, or direct Fastify plugin
  registration, rather than silently routing them through the new
  default runtime and dropping supported behavior
- Introduce `cedarUniversalDeployPlugin()` in `@cedarjs/vite` and wire
  it into the **API server Vite build config**: register
  `virtual:cedar-api` with the UD store via `addEntry()`, resolve
  `virtual:ud:catch-all` → `virtual:cedar-api`, and export the Cedar
  API Fetchable as the virtual module's default export. This plugin
  belongs to the API server build — not the web client build — because
  it resolves API-server virtual modules that have no relevance to the
  browser bundle. When the plugin is introduced, add
  `@cedarjs/api-server` as a `peerDependency` of `@cedarjs/vite` in
  `packages/vite/package.json` — the virtual module emitted by the
  plugin imports `buildCedarDispatcher` from `@cedarjs/api-server`, so
  consumers need it installed alongside `@cedarjs/vite`
- Add `node()` from `@universal-deploy/node/vite` to the same API
  server Vite build config (not the web client config, and not the
  HTML SSR config — see naming caution below). After this,
  `cedar serve` runs the Vite-built server entry instead of `createUDServer`

**Naming caution**: Vite calls its Node.js server build environment
**"SSR"** regardless of whether it renders HTML. This is confusing in
Cedar's context, where "SSR" specifically means React streaming / RSC.
The Vite "SSR environment" output that `@universal-deploy/node`
produces is purely the API server entry — it has no connection to
Cedar's HTML SSR feature. Do not add `node()` to any Vite config that
also builds the HTML SSR entry.

#### Deliverables

- One `cedar dev` command that starts both web and API dev servers
- API code compiled through Vite's module graph with true HMR
- `@universal-deploy/node` wired end-to-end: Vite builds a
  self-contained server entry; `cedar serve` runs it on the default
  runtime path
- A documented compatibility path for apps with custom Fastify server
  setup

#### Exit Criteria

- `cedar dev` runs both web and API dev servers from one CLI command
- API functions receive Vite HMR without nodemon process restarts
- `cedar serve` runs an `@universal-deploy/node`-built server entry on
  the default runtime path, completing the Phase 3 goal of removing
  Fastify from that production path
- Existing apps with custom Fastify server setup still have a supported
  compatibility path and are not silently forced onto the new default
  runtime

**User-facing impact**: Medium (positive). Developers get one CLI command
and faster API HMR. The port model is still two ports (`8910` + `8911`);
the single-port simplification arrives in Phase 5. Existing apps with
custom Fastify setup remain on a compatibility path until a later migration
story exists. Config files may need minor updates.

---

### Phase 5: Idiomatic Vite Full-Stack Integration

**Effort: L (Large)**

Depends on Phase 4.

#### Goal

Close the architectural gap between Phase 4's incremental bridge and an
idiomatic Vite full-stack integration. Phase 4 delivered user-facing wins
(one `cedar dev` command, API HMR, Vite-built serve output) using two HTTP
listeners in dev and three separate `viteBuild()` calls in production. Phase
5 makes the underlying architecture match what the Vite team recommends for
full-stack frameworks.

#### Two Workstreams

**1. Single-listener dev server**

Replace the two-listener dev model with one Vite dev server on a single
visible port. API requests are handled inline via Vite middleware rather
than by a separate Fastify listener. This eliminates the last proxy/port
split, simplifies auth flows and CORS, and aligns Cedar with Nuxt,
SvelteKit, and other Vite full-stack frameworks.

- Introduce a Vite dev-server plugin (e.g. `cedarDevDispatcherPlugin` or
  equivalent) that mounts Cedar's fetch-native API dispatcher directly
  into the web Vite dev server's middleware stack. When the plugin is
  active, API requests are served inline without proxying to a separate
  port.
- Remove the separate Fastify API listener from `cedar-unified-dev`;
  the web Vite server becomes the only visible HTTP listener.

**2. `buildApp()` with declared environments**

Replace the three standalone `viteBuild()` calls with a single `buildApp()`
invocation that declares `client` and `api` environments. Both environments
share one module graph, one transform pipeline, and consistent resolution.
This reduces build time, eliminates silent divergence between client and API
builds, and prepares the infrastructure for a future SSR environment.

#### Deliverables

- refactored `cedar-unified-dev` using a single Vite dev server with inline
  API middleware (no separate API listener)
- refactored `cedar build` using `buildApp()` with `client` and `api`
  environments
- updated documentation reflecting the single-port dev model and unified build

#### Exit Criteria

- `cedar dev` runs on one visible port with no separate API listener
- `cedar build` uses `buildApp()` with declared environments in a single pass
- All existing Phase 4 functionality continues to work
- The custom Fastify compatibility lane is unaffected

**User-facing impact**: Low. Internal architecture alignment; no new user
features.

---

### Phase 6: Formalise the Cedar UD Vite Plugin

**Effort: M (Medium)**

Depends on Phase 5.

#### Goal

Expand `cedarUniversalDeployPlugin()` from a single aggregate entry into a
complete, per-route registration that UD adapters and provider plugins can
rely on. Phase 4 ships a working plugin with one catch-all entry; Phase 5
makes the Vite integration idiomatic; Phase 6 makes the plugin correct and
provider-discoverable.

#### Current state after Phase 5

`cedarUniversalDeployPlugin()` exists and provides:

- A single aggregate `virtual:cedar-api` entry registered with
  `addEntry()`, covering all Cedar API routes via one catch-all
  Fetchable
- `virtual:cedar-api` virtual module: exports Cedar's API Fetchable
  so UD adapters can consume it
- `virtual:ud:catch-all` → `virtual:cedar-api` resolution: routes
  the UD catch-all ID (used by `@universal-deploy/node/serve`) to
  Cedar's aggregate API entry

#### Work

- Replace the single `virtual:cedar-api` aggregate entry with
  per-function entries derived from Cedar's route manifest (Phase 2),
  so providers that benefit from per-route isolation (e.g., Cloudflare
  Workers) can split on individual functions
- Ensure all Cedar server entries are registered with the correct
  `route`, `method`, and `environment` metadata:
  - GraphQL entry
  - auth entry
  - filesystem-discovered function entries
  - web catch-all / SPA fallback (web side)
- Align Cedar's `CedarRouteRecord` manifest (Phase 2) with the
  `EntryMeta` shape UD's store expects — entries should be derived
  from the manifest, not maintained separately
- Update `virtual:ud:catch-all` to generate a proper multi-route
  dispatcher (using rou3 across all registered entries) rather than
  the simple single-entry re-export from Phase 4
- Validate the plugin against `@universal-deploy/node` and
  `@universal-deploy/adapter-netlify`
- Document the plugin's role so future UD adapter authors know what
  Cedar registers and in what shape

#### Deliverables

- `cedarUniversalDeployPlugin()` expanded with per-route entries
  from Cedar's route manifest
- All Cedar server entries registered via `addEntry()` with complete
  metadata at Vite/plugin time
- Cedar's route manifest and UD's store in sync from a single source
  of truth
- Validated against `@universal-deploy/node` end-to-end

#### Exit Criteria

- Provider plugins can discover Cedar's server entries without custom
  Cedar-specific logic
- Cedar's `CedarRouteRecord` manifest is the single source of truth
  from which UD entries are derived

**User-facing impact**: None directly. Enables deploy provider support.

---

### Phase 7: Rebuild SSR on the New Runtime

**Effort: XL (Extra Large)**

Design work can begin **during Phases 5–6**. Implementation depends on
Phase 1 (handler contract and middleware model).

#### Goal

Replace the current experimental SSR architecture with a Fetch-native
SSR entry model.

#### Work

- Treat SSR as a Cedar server entry that returns `Response`
- Rebuild middleware execution on top of Fetch-native request/response
  flow — the `CedarMiddleware` model from Phase 1 applies directly
- Preserve existing Cedar concepts where they are still valid:
  - cookies
  - auth state
  - route hooks
  - streaming responses
- Remove dependence on the current Express-based runtime
- Decide what pieces of the current streaming/RSC pipeline are worth
  keeping versus rewriting

#### Deliverables

- A new SSR runtime aligned with Cedar's Fetch-native core

#### Exit Criteria

- Cedar SSR no longer depends on the old experimental Express
  implementation
- SSR fits naturally into the same entry + route model used by UD

**User-facing impact**: High for SSR users. Will require migration of
SSR-specific configuration.

---

### Phase 8: Provider Validation

**Effort: L (Large)**

Depends on Phases 6 and 7.

#### Goal

Validate the end-to-end architecture against the provider/runtime
targets Cedar cares about.

#### Work

- Validate Netlify and Vercel first (largest user base)
- Validate Node/self-hosted via `@universal-deploy/node`
- Optionally validate Cloudflare after the first pass
- Use UD's adapters (`@universal-deploy/node`,
  `@universal-deploy/adapter-netlify`, and equivalent) — Cedar builds
  none of its own
- Test:
  - functions
  - GraphQL
  - auth/cookies
  - route matching
  - streaming SSR
  - static asset behavior

#### Deliverables

- Fixture apps and integration tests
- Provider compatibility matrix

#### Exit Criteria

- At least two cloud providers and Node self-hosting work end-to-end

**User-facing impact**: High (positive). Deploy targets work.

## Phase Summary

| Phase | Description                | Effort | Parallel? | User-Facing? |
| ----- | -------------------------- | ------ | --------- | ------------ |
| 1     | Fetch-native handlers      | L      | —         | No (shim)    |
| 2     | Route discovery            | M      | With 3    | No           |
| 3     | UD adapter adoption        | M      | With 2    | No           |
| 4     | Vite-centric dev           | XL     | —         | Yes          |
| 5     | Idiomatic Vite integration | L      | —         | No           |
| 6     | UD registration            | M      | —         | No           |
| 7     | SSR rebuild                | XL     | Design‡   | Yes          |
| 8     | Provider validation        | L      | —         | Yes          |

‡ Design work can overlap with Phases 5–6.

## Transitional Developer Experience

During intermediate phases, the developer experience changes
gradually:

**After Phase 1 only** (Phases 2–3 not yet done): The two-port dev
model (`8910` + `8911`) persists. Internally, handlers are Fetch-native,
but Fastify still wraps them for the dev server. The compatibility shim
means existing app handlers keep working. **Most app developers notice
nothing.**

**After Phases 1–3** (Phase 4 not yet done): Same as above from the
developer's perspective. UD's node adapter is wired up but used only
for production self-hosting. Dev still uses two ports.

**After Phase 4**: Single-port dev on the default runtime path. This is
the first major visible change. Developers on the standard Cedar path
update their config and enjoy a simpler mental model. Apps with custom
Fastify server setup remain on a compatibility path rather than being
silently forced onto the new runtime.

**After Phase 5**: No visible change for developers. Internal architecture
alignment only.

**After Phase 6**: No visible change for developers. UD integration is
framework-internal.

**After Phases 7–8**: Full SSR support on the new runtime. Deploy to
supported providers.

## Migration Path

Even though minimizing breaking changes is a non-goal, a responsible
migration path is provided.

### Compatibility Shim (Phase 1)

Existing legacy-shaped handlers are wrapped automatically by
`wrapLegacyHandler`.
This buys time for app developers to migrate at their own pace.

GraphQL has a similar transitional bridge during Phase 1, but at the
plugin-context level rather than the server-entry level: Cedar may
continue to provide `event` and `requestContext` to existing Yoga
plugins while also introducing `request` and `cedarContext`. This is
meant to preserve compatibility while Cedar-owned GraphQL plugins are
updated to prefer Fetch-native context.

### Codemod for Handler Migration

A codemod should be provided to convert existing handlers:

```ts
// Before: Lambda-shaped
export const handler = async (event, context) => {
  const body = JSON.parse(event.body)
  return {
    statusCode: 200,
    body: JSON.stringify({ data: body }),
  }
}

// After: Cedar handleRequest shape
export async function handleRequest(request, ctx) {
  const body = await request.json()
  return new Response(JSON.stringify({ data: body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

The codemod handles the common patterns:

- `event.body` → `request.json()` / `request.text()`
- `event.headers` → `request.headers`
- `event.queryStringParameters` → `ctx.query`
- `event.httpMethod` → `request.method`
- return shape → `new Response(...)`

Edge cases that the codemod cannot handle are flagged with TODO
comments for manual review.

### Migration Guide

A migration guide should accompany each phase that has user-facing
impact (Phases 4, 7, 8). The guide should cover:

- What changed and why
- Step-by-step migration instructions
- Before/after code examples
- Common pitfalls
- How to identify whether an app is on the default runtime path or the
  custom Fastify compatibility path

### Which Phases Require App Developer Action

| Phase | App Developer Action Required                                                       |
| ----- | ----------------------------------------------------------------------------------- |
| 1     | None (shim handles it)                                                              |
| 2     | None                                                                                |
| 3     | None                                                                                |
| 4     | Config updates for standard apps; compatibility-path review for custom Fastify apps |
| 5     | None                                                                                |
| 6     | None                                                                                |
| 7     | SSR config migration                                                                |
| 8     | Deploy config updates                                                               |

## Risks

- Trying to integrate UD before Cedar has standardized its handler
  contract
- Carrying forward Lambda-specific assumptions too long — the
  compatibility shim must have a planned deprecation timeline
- Preserving too much of the current SSR implementation and inheriting
  its complexity
- Formalizing backend routing without resolving Cedar's actual runtime
  contract
- Introducing a Cedar context abstraction that leaks provider-specific
  concepts
- The middleware model migration being more complex than expected due
  to edge cases in existing auth middleware
- Phase 4 (Vite-centric dev) being significantly harder than estimated
  due to HMR, module graph, and backend file watching interactions
- Silently dropping supported Fastify-specific behavior for existing
  apps that use `api/src/server.{ts,js}`, `configureFastify`,
  `configureApiServer`, or direct Fastify plugin registration

## Open Questions

- Whether auth routes remain framework-defined conventions or become
  explicit user-visible route handlers
- Whether RSC remains part of the post-UD roadmap or is deferred until
  a new SSR core is stable
- What the deprecation timeline for `wrapLegacyHandler` should be
  (one major version? two?)
- Whether the existing `MiddlewareRequest`/`MiddlewareResponse` types
  should be kept as deprecated aliases or removed in the same release
  as the new middleware model

## Recommendation

Do not begin with UD plugin work or SSR migration.

Begin by making Cedar's backend Fetch-native with:

```ts
export async function handleRequest(
  request: Request,
  ctx: CedarRequestContext
): Promise<Response>
```

**Why `handleRequest` and not `handler`**: `handler` is the exact export name
AWS Lambda uses (`export async function handler(event, context)`). Even
though the signatures are completely different, the name collision
creates a misleading mental model that Cedar is still Lambda-first.
`handleRequest` is explicit about what it does — it handles an incoming
HTTP request — and carries no Lambda-specific baggage. The internal type
`CedarHandler` (describing what kind of thing a handler is) is unaffected
by this choice.

**Why two shapes and not one**: Framework developers and deployment
providers strongly prefer `export default { async fetch(request) }` as
the deployment artifact. Cedar agrees — and that is exactly what Cedar's
build tooling should emit for WinterTC-compatible targets. But app
developers need `handleRequest(request, ctx)` because `ctx` carries
Cedar-specific enrichments (parsed cookies, route params, auth state)
that no platform provides natively. Making app developers write
`export default { fetch }` directly would mean losing the `ctx`
parameter or hiding it behind module-level magic. The two-layer model
keeps both audiences happy: Cedar app developers write `handleRequest()`, Cedar
generates the right deployment artifact.

Wrap GraphQL (via Yoga) first — it is the quickest validation of the
contract against a real entry point. Then formalize middleware, ship the
legacy handler compatibility shim (`wrapLegacyHandler`), and migrate
auth middleware.

Once Cedar has that core contract, explicit backend route metadata, and
the middleware model, the remaining UD work becomes implementation
detail instead of architectural guesswork.

Phase 2 and Phase 3 can proceed in parallel immediately after Phase 1.
Phase 7 design work can start during Phases 5–6. Take advantage of
this parallelism to reduce the overall timeline.
