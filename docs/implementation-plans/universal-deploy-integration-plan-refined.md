# Refined Plan: Cedar + Universal Deploy Integration

## Summary

Adopting
[Universal Deploy](https://github.com/universal-deploy/universal-deploy)
(UD) in Cedar requires moving from the current split runtime model —
Vite for web, Fastify/Lambda for API — to a unified Fetch-native model
where:

- Cedar's primary server contract is
  `handle(request: Request, ctx: CedarRequestContext): Response`
- Vite is the full-stack dev host
- Cedar exposes explicit server entries and route metadata for providers
- SSR becomes just another server entry, not a special legacy runtime

The `handle()` contract is Phase 1 because everything else depends on
it. The context object carries only Cedar-specific enrichments —
`headers` and `url` already live on `Request` and must not be
duplicated.

Cedar uses two distinct handler shapes: `handle(request, ctx)` as the
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
- Minimizing breaking changes for existing Cedar apps (though a
  migration path is provided)
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

- **Authoring surface** — `handle(request, ctx)`, used by Cedar app
  developers and middleware authors. The `ctx` parameter carries
  Cedar-specific enrichments no platform provides natively.
- **Deployment artifact** — `export default { fetch(request) }`, the
  WinterTC-compatible shape Cedar's build tooling emits for provider
  consumption.

The transformation between these layers is Cedar's responsibility. App
developers never write `export default { fetch }`; Cedar generates it.
Provider integrators never see `CedarRequestContext`; Cedar populates it
internally before calling `handle()`.

## The Handler Contract

```ts
interface CedarRequestContext {
  cookies: ReadonlyMap<string, string>
  params: Record<string, string>
  query: URLSearchParams
  serverAuthState?: ServerAuthState
}

export async function handle(
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
export async function handle(
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
    return handle(request, ctx)
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
developers interact with `handle(request, ctx)`**. Adapters (see The
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
       return handle(request, ctx)
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

- `@universal-deploy/adapter-node` — wraps store entries with `srvx`
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
into a `CedarRequestContext` before calling `handle()`. This is not a
deployment adapter — it is Cedar's request enrichment step, and it
runs inside every `fetch()` wrapper Cedar emits.

### What This Means in Practice

A Cedar app's production deployment looks like this:

```
Cedar build tooling emits:    export default { fetch }    (Fetchable, per entry)
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
  the Node runtime is provided by `@universal-deploy/adapter-node`

## Implementation Phases

### Phase Dependency Graph

Phases are not strictly sequential. After Phase 1 completes:

- **Phase 2** (route discovery) and **Phase 3** (UD adapter adoption)
  can proceed **in parallel** — they have no dependency on each other,
  only on Phase 1
- **Phase 4** depends on Phases 2 and 3
- **Phase 5** depends on Phase 4
- **Phase 6** (SSR rebuild) can begin **design work during Phases
  4–5** — the handler contract and middleware model are already
  stable after Phase 1
- **Phase 7** depends on Phases 5 and 6

```
Phase 1 ──┬── Phase 2 ──┐
           │             ├── Phase 4 ── Phase 5 ──┐
           └── Phase 3 ──┘                        ├── Phase 7
                    Phase 6 (design: Phase 4–5) ──┘
```

---

### Phase 1: Adopt Fetch-Native Cedar Handlers

**Effort: L (Large)**

This is the foundational phase. Everything else depends on it.

#### Goal

Make this Cedar's primary backend handler contract:

```ts
export async function handle(
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
WinterTC-compatible `Fetchable` entries and wiring them into UD's
adapter ecosystem. Cedar builds no adapters of its own.

#### Work

- Implement `buildCedarContext(request)` — the internal enrichment
  step that produces `CedarRequestContext` from a standard `Request`
- Implement Cedar's build tooling to wrap each `handle()` export in a
  `Fetchable`:
  ```ts
  // Generated output per Cedar server entry
  export default {
    async fetch(request: Request): Promise<Response> {
      const ctx = await buildCedarContext(request)
      return handle(request, ctx)
    },
  }
  ```
- Integrate `@universal-deploy/store`: call `addEntry()` for each
  Cedar server entry (GraphQL, auth, filesystem functions) during the
  build
- Validate self-hosting using `@universal-deploy/adapter-node`, which
  wraps store entries with `srvx` + `sirv` — Cedar does not implement
  any Node HTTP handling itself
- Validate Netlify deployment using `@universal-deploy/adapter-netlify`
  as an early end-to-end check
- Confirm `yarn rw serve` delegates to UD's node adapter rather than
  Fastify

#### Deliverables

- `buildCedarContext` utility in a shared framework package
- Build tooling that emits `Fetchable` entries per Cedar server entry
- `@universal-deploy/store` integration (`addEntry` calls at build time)
- Validated self-hosting via `@universal-deploy/adapter-node`

#### Exit Criteria

- Cedar can run in production on Node without Fastify, using
  `@universal-deploy/adapter-node`
- Cedar's server entries are registered in the UD store at build time
- `yarn rw serve` no longer depends on the Fastify-first API server
  architecture

**User-facing impact**: None for most developers. Self-hosting users
get a simpler, Fastify-free production server backed by UD's node
adapter.

---

### Phase 4: Move Dev to Vite-Centric Full-Stack Runtime

**Effort: XL (Extra Large)**

Depends on Phases 2 and 3.

#### Goal

Replace the current web+API split dev model with a single Vite-hosted
development entrypoint.

#### Work

- Eliminate the `8910 → proxy → 8911` mental model
- Route page, GraphQL, auth, and function requests through one
  externally visible dev host
- Integrate backend handler execution into the Vite dev runtime
  (likely via Vite's `server.middlewareMode` or custom plugin)
- Ensure server-side file watching and invalidation work for backend
  entries
- Preserve strong DX for browser requests, direct `curl` requests,
  and GraphQL tooling (e.g., GraphiQL must still work)

#### Deliverables

- One visible development port
- One dev request dispatcher
- One shared module graph for frontend and backend development

#### Exit Criteria

- Cedar dev no longer requires a separately exposed backend port
- Requests to functions and GraphQL can be made directly against the
  Vite dev host

**User-facing impact**: High (positive). Developers see one port, one
process, simpler mental model. Config files may need minor updates.

---

### Phase 5: Formalise the Cedar UD Vite Plugin

**Effort: M (Medium)**

Depends on Phase 4.

#### Goal

Promote the initial `addEntry()` wiring from Phase 3 into a
first-class Cedar Vite plugin in `@cedarjs/vite`. Phase 3 gets Cedar
running without Fastify using UD's adapters; Phase 5 makes the
integration complete, correct, and provider-discoverable.

#### Work

- Extract the `addEntry()` calls from Phase 3's ad-hoc build wiring
  into a formal `@cedarjs/vite` plugin
- Ensure all Cedar server entries are registered with the correct
  `route`, `method`, and `environment` metadata that UD and provider
  plugins need:
  - web catch-all SSR entry (or SPA fallback)
  - GraphQL entry
  - auth entry
  - filesystem-discovered function entries
- Align Cedar's internal `CedarRouteRecord` manifest (from Phase 2)
  with the `EntryMeta` shape UD's store expects — Cedar should derive
  UD entries from its own route manifest, not maintain them separately
- Validate the plugin against `@universal-deploy/adapter-node` and
  `@universal-deploy/adapter-netlify`
- Document the plugin's role so future UD adapter authors know what
  Cedar registers and in what shape

#### Deliverables

- `@cedarjs/vite` Cedar UD plugin
- All Cedar server entries registered via `addEntry()` with complete
  metadata at Vite/plugin time
- Cedar's route manifest and UD's store in sync from a single source
  of truth

#### Exit Criteria

- Provider plugins can discover Cedar's server entries without custom
  Cedar-specific logic
- Cedar's `CedarRouteRecord` manifest is the single source of truth
  from which UD entries are derived

**User-facing impact**: None directly. Enables deploy provider support.

---

### Phase 6: Rebuild SSR on the New Runtime

**Effort: XL (Extra Large)**

Design work can begin **during Phases 4–5**. Implementation depends on
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

### Phase 7: Provider Validation

**Effort: L (Large)**

Depends on Phases 5 and 6.

#### Goal

Validate the end-to-end architecture against the provider/runtime
targets Cedar cares about.

#### Work

- Validate Netlify and Vercel first (largest user base)
- Validate Node/self-hosted via `@universal-deploy/adapter-node`
- Optionally validate Cloudflare after the first pass
- Use UD's adapters (`@universal-deploy/adapter-node`,
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

| Phase | Description           | Effort | Parallel? | User-Facing? |
| ----- | --------------------- | ------ | --------- | ------------ |
| 1     | Fetch-native handlers | L      | —         | No (shim)    |
| 2     | Route discovery       | M      | With 3    | No           |
| 3     | UD adapter adoption   | M      | With 2    | No           |
| 4     | Vite-centric dev      | XL     | —         | Yes          |
| 5     | UD registration       | M      | —         | No           |
| 6     | SSR rebuild           | XL     | Design‡   | Yes          |
| 7     | Provider validation   | L      | —         | Yes          |

‡ Design work can overlap with Phases 4–5.

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

**After Phase 4**: Single-port dev. This is the first major visible
change. Developers update their config and enjoy a simpler mental model.

**After Phase 5**: No visible change for developers. UD integration is
framework-internal.

**After Phases 6–7**: Full SSR support on the new runtime. Deploy to
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

// After: Cedar handle shape
export async function handle(request, ctx) {
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
impact (Phases 4, 6, 7). The guide should cover:

- What changed and why
- Step-by-step migration instructions
- Before/after code examples
- Common pitfalls

### Which Phases Require App Developer Action

| Phase | App Developer Action Required               |
| ----- | ------------------------------------------- |
| 1     | None (shim handles it)                      |
| 2     | None                                        |
| 3     | None                                        |
| 4     | Config updates, possible dev script changes |
| 5     | None                                        |
| 6     | SSR config migration                        |
| 7     | Deploy config updates                       |

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
export async function handle(
  request: Request,
  ctx: CedarRequestContext
): Promise<Response>
```

**Why `handle` and not `handler`**: `handler` is the exact export name
AWS Lambda uses (`export async function handler(event, context)`). Even
though the signatures are completely different, the name collision
creates a misleading mental model that Cedar is still Lambda-first.
`handle` is a verb — you `handle` a request — and carries no
Lambda-specific baggage. The internal type `CedarHandler` (describing
what kind of thing a handler is) is unaffected by this choice.

**Why two shapes and not one**: Framework developers and deployment
providers strongly prefer `export default { async fetch(request) }` as
the deployment artifact. Cedar agrees — and that is exactly what Cedar's
build tooling should emit for WinterTC-compatible targets. But app
developers need `handle(request, ctx)` because `ctx` carries
Cedar-specific enrichments (parsed cookies, route params, auth state)
that no platform provides natively. Making app developers write
`export default { fetch }` directly would mean losing the `ctx`
parameter or hiding it behind module-level magic. The two-layer model
keeps both audiences happy: Cedar app developers write `handle()`, Cedar
generates the right deployment artifact.

Wrap GraphQL (via Yoga) first — it is the quickest validation of the
contract against a real entry point. Then formalize middleware, ship the
legacy handler compatibility shim (`wrapLegacyHandler`), and migrate
auth middleware.

Once Cedar has that core contract, explicit backend route metadata, and
the middleware model, the remaining UD work becomes implementation
detail instead of architectural guesswork.

Phase 2 and Phase 3 can proceed in parallel immediately after Phase 1.
Phase 6 design work can start during Phases 4–5. Take advantage of
this parallelism to reduce the overall timeline.
