# Plan: Cedar + Universal Deploy Integration

## Summary

Adopting
[Universal Deploy](https://github.com/universal-deploy/universal-deploy) (UD) in
Cedar is not a narrow deployment integration.
It requires Cedar to move from its current split runtime model:

- web dev/runtime centered around Vite
- api dev/runtime centered around Fastify, esbuild, and Lambda-style handlers
- provider-specific deployment assumptions

to a unified model where:

- Vite is the full-stack dev host
- Cedar's primary server contract is Fetch-native
- Cedar exposes explicit server entries and route metadata for providers
- SSR becomes just another server entry, instead of a special legacy (express)
  runtime

The first and most important step is to standardize the backend handler shape
around a Cedar-native Fetch contract:

```ts
interface CedarRequestContext {
  headers: Headers
  url: URL
  cookies: CookieJar
  params?: Record<string, string>
  query?: Record<string, string | string[] | undefined>
  serverAuthState?: ServerAuthState
}

export async function handler(
  request: Request,
  ctx?: CedarRequestContext
): Promise<Response>
```

This plan intentionally treats that contract as Phase 1 and sequences all other
UD-related work after it.

Read more about framework specific integration here:
https://github.com/universal-deploy/universal-deploy/blob/main/docs/framework-developers.md

## Goals

- Adopt a Cedar-native Fetch-style server contract for backend handlers
- Preserve a Cedar-specific request context based on concepts that already exist
  in the codebase
- Replace Lambda-first backend assumptions with a portable runtime model
- Move Cedar toward a single-port, Vite-centric full-stack development model
- Formalize Cedar route metadata and server entries for UD registration
- Establish a clean Node/self-hosted adapter story for baremetal and VPS deploys
- Rebuild SSR on top of the new runtime model instead of extending the current
  experimental implementation

## Non-Goals

- Preserving the current AWS Lambda handler shape as Cedar's primary contract
- Preserving the current Express-based SSR runtime as foundational architecture
- Minimizing breaking changes for existing Cedar apps
- Implementing full UD support before Cedar has standardized its own runtime
  contracts

## Current State

Today Cedar uses different runtime models on the web and api sides.

### Web Side

- Vite is used for frontend dev server behavior
- SPA routes are defined in `Routes.tsx`
- `Routes.tsx` is a Cedar routing DSL, not a normal React component
- In SPA mode, Vite proxies API requests to the separate api server

### API Side

- Local dev uses a separate backend runtime based on Fastify
- Backend functions are built and served outside the Vite runtime
- API functions are fundamentally modeled as AWS Lambda-style handlers
- Fastify acts largely as an adapter that maps HTTP requests to Lambda-shaped
  function invocations
- GraphQL is closer to Fetch internally because Yoga already exposes `fetch()`
  semantics

### Routing

- Frontend route metadata is explicit through `Routes.tsx`
- Backend routes are more implicit:
  - GraphQL
  - auth endpoints
  - filesystem-discovered functions
  - app-defined internal method/sub-route dispatch

### SSR

- Cedar has experimental streaming SSR / RSC support
- The current implementation is old, custom, and lightly maintained
- It should not be treated as a stable foundation for UD adoption

## Guiding Principles

### 1. Cedar Owns Its Runtime Contract

UD should integrate with Cedar after Cedar standardizes its own request
handling. Cedar should not directly adopt Cloudflare, Netlify, or Vercel
handler signatures as its primary framework contract.

### 2. Fetch Is the Center of Gravity

The Cedar core runtime should be modeled as:

- input: `Request`
- output: `Response`

Adapters can translate that core contract to provider-specific entry formats.

### 3. Cedar Context Should Be Cedar-Specific

`CedarRequestContext` should only contain concepts that already exist in Cedar's
request model. It should not expose provider-specific `env` or `ctx` objects as
framework primitives.

### 4. SSR Comes After Runtime Modernization

SSR should be rebuilt on top of the new Fetch-native core, not ported forward
as a special case from the current experimental implementation.

## Why Start With `handler(request, ctx?)`

This is the best first step because it isolates the biggest architectural issue:
Cedar's backend is still Lambda-first.

Standardizing on:

```ts
export async function handler(
  request: Request,
  ctx?: CedarRequestContext
): Promise<Response>
```

unlocks the later phases:

- Vite can host these handlers in dev
- UD can point providers at explicit server entries
- Node adapters can run the same contract for self-hosting
- GraphQL can align with its existing Fetch-native internals
- SSR can eventually become another Cedar handler

Without this step, Cedar would be trying to integrate UD while still carrying a
runtime split between Vite and Lambda/Fastify semantics.

## CedarRequestContext

This plan uses a Cedar-owned request context based on concepts that already
exist in the framework today.

```ts
interface CedarRequestContext {
  headers: Headers
  url: URL
  cookies: CookieJar
  params?: Record<string, string>
  query?: Record<string, string[] | string | undefined>
  serverAuthState?: ServerAuthState
}
```

### Why These Fields

These are already real Cedar concepts:

- `headers`
  - already stored and retrieved by `@cedarjs/server-store`
- `url`
  - Cedar already stores `fullUrl` and exposes a URL accessor
- `cookies`
  - Cedar already uses `CookieJar` in middleware and server-store
- `params`
  - Cedar already passes params into middleware and route hooks
- `query`
  - Cedar route hooks already expect parsed query data
- `serverAuthState`
  - Cedar already uses server auth state in SSR/middleware flows

### What Is Intentionally Excluded

These are not part of the initial Cedar context:

- provider-specific `env`
- provider-specific `ctx`
- `waitUntil`
- Vite dev server references
- arbitrary platform bindings

Those may be introduced later through adapter internals or a future Cedar
runtime abstraction, but they should not block the initial contract migration.

## Target Architecture

The long-term Cedar + UD architecture should look like this:

### Development

- Vite is the externally visible full-stack dev host
- Cedar registers server entries into the Vite runtime
- requests for pages, GraphQL, auth, and functions are dispatched without a
  proxy hop to a separate api server
- frontend and backend updates share one module graph and one watcher model

### Production

- Cedar builds explicit server entries for providers and Node/self-hosting
- UD consumes Cedar's entry + route metadata
- Node/baremetal deployments run a thin Node adapter around Cedar handlers
- Nginx or another reverse proxy can sit in front, but Cedar exposes one
  unified app server contract

## Implementation Phases

## Phase 1: Adopt Fetch-Native Cedar Handlers

### Goal

Make this Cedar's primary backend handler contract:

```ts
export async function handler(
  request: Request,
  ctx?: CedarRequestContext
): Promise<Response>
```

### Work

- define `CedarRequestContext` in a framework package that both api and future
  web runtimes can consume
- add a first-class Fetch-native handler loader/executor for backend functions
- introduce adapters that can still invoke Fetch-native handlers from current
  Node/Fastify infrastructure during the transition
- migrate or wrap GraphQL so that Cedar treats it as a Fetch-native backend
  entry at the framework boundary
- formalize request normalization:
  - request URL
  - headers
  - query parsing
  - cookies
  - auth state
- establish test coverage for:
  - direct function invocation
  - GraphQL requests
  - auth/cookie handling
  - query parsing
  - response headers and status codes

### Deliverables

- a stable Fetch-native Cedar handler contract
- function execution that no longer depends on Lambda shape internally
- a Cedar-owned request context abstraction backed by existing framework data

### Exit Criteria

- Cedar functions can be authored and executed with `Request -> Response`
- GraphQL can be treated as a Fetch-native Cedar server entry
- Fastify is no longer the defining contract for Cedar backend execution

## Phase 2: Formalize Backend Route Discovery

### Goal

Turn Cedar's implicit backend routing model into explicit route metadata.

### Work

- define a normalized backend route record type
- enumerate and register:
  - GraphQL
  - auth endpoints
  - filesystem-discovered functions
  - any built-in health/readiness or related routes
- formalize how function route names map to URL paths and methods
- decide whether Cedar keeps one function dispatcher entry or moves toward one
  entry per function
- align frontend route metadata from `Routes.tsx` with backend route metadata
  enough to produce one coherent routing model

### Deliverables

- explicit backend route manifest generation
- one source of truth for backend route shape

### Exit Criteria

- Cedar can list all provider-relevant backend routes without relying on
  framework-specific server wiring

## Phase 3: Introduce a Thin Node Adapter

### Goal

Support Cedar's Fetch-native runtime in Node without requiring Fastify as the
primary app contract.

### Work

- implement a thin Node server adapter for Cedar handlers
- prefer a Fetch-oriented adapter layer over a framework-first server
- support local production runs and VPS/self-hosting
- support static asset and dynamic request handoff expectations needed by Cedar
  web apps
- preserve the ability to run behind Nginx or another reverse proxy

### Deliverables

- a Node adapter suitable for local serve and baremetal/VPS deployments

### Exit Criteria

- Cedar can run its new handler model in Node without depending on the current
  Fastify-first api server architecture

## Phase 4: Move Dev to a Vite-Centric Full-Stack Runtime

### Goal

Replace the current web+api split dev model with a single Vite-hosted
development entrypoint.

### Work

- eliminate the `8910 -> proxy -> 8911` mental model
- route page, GraphQL, auth, and function requests through one externally
  visible dev host
- integrate backend handler execution into the Vite dev runtime
- ensure server-side file watching and invalidation work for backend entries
- preserve strong DX for browser requests, direct `curl` requests, and GraphQL
  tooling

### Deliverables

- one visible development port
- one dev request dispatcher
- one shared module graph for frontend and backend development

### Exit Criteria

- Cedar dev no longer requires a separately exposed backend port
- requests to functions and GraphQL can be made directly against the Vite dev
  host

## Phase 5: Expose Explicit Server Entries and Route Metadata to UD

### Goal

Make Cedar provider-readable by registering explicit server entries and routes
through UD.

### Work

- add a Cedar UD integration layer in `@cedarjs/vite`
- register Cedar server entries via UD store APIs
- publish route metadata in a format UD and provider plugins can consume
- start with a small set of framework-managed entries, likely:
  - web catch-all SSR entry
  - GraphQL entry
  - auth/function entries or a dispatcher entry
- ensure route patterns and methods are explicit
- ensure Cedar-owned route formats are converted into provider-usable metadata

### Deliverables

- a Cedar UD registration plugin
- explicit entry + route registrations at Vite/plugin time

### Exit Criteria

- provider plugins can discover Cedar's server entries without custom
  Cedar-specific logic

## Phase 6: Rebuild SSR on the New Runtime

### Goal

Replace the current experimental SSR architecture with a Fetch-native SSR entry
model.

### Work

- treat SSR as a Cedar server entry that returns `Response`
- rebuild middleware execution on top of Fetch-native request/response flow
- preserve existing Cedar concepts where they are still valid:
  - cookies
  - auth state
  - route hooks
  - streaming responses
- remove dependence on the current Express-based runtime as a framework
  foundation
- decide what pieces of the current streaming/RSC pipeline are worth keeping
  versus rewriting

### Deliverables

- a new SSR runtime aligned with Cedar's Fetch-native core

### Exit Criteria

- Cedar SSR no longer depends on the old experimental Express implementation
- SSR fits naturally into the same entry + route model used by UD

## Phase 7: Provider Validation

### Goal

Validate the end-to-end architecture against the provider/runtime targets Cedar
cares about.

### Work

- validate Netlify and Vercel first
- validate Node/self-hosted via the Node adapter
- optionally validate Cloudflare after the first pass if desired
- test:
  - functions
  - GraphQL
  - auth/cookies
  - route matching
  - streaming SSR
  - static asset behavior

### Deliverables

- fixture apps and integration tests
- provider compatibility matrix

## Suggested Work Breakdown

The first shipping sequence should be:

1. Phase 1: Fetch-native handler contract
2. Phase 2: explicit backend route discovery
3. Phase 3: thin Node adapter
4. Phase 4: Vite-centric full-stack dev runtime
5. Phase 5: UD registration
6. Phase 6: SSR rebuild
7. Phase 7: provider validation

This order keeps the work grounded in Cedar's actual runtime needs instead of
starting with deployment plugin wiring.

## Risks

- trying to integrate UD before Cedar has standardized its handler contract
- carrying forward Lambda-specific assumptions too long
- preserving too much of the current SSR implementation and inheriting its
  complexity
- formalizing backend routing without resolving Cedar's actual runtime contract
- introducing a Cedar context abstraction that leaks provider-specific concepts

## Open Questions

- whether Cedar should support both `handler(request, ctx?)` and generated
  `default { fetch() }` entry wrappers, or standardize more strongly on one
  authoring shape
- whether backend functions should become one entry per route or remain grouped
  under a Cedar dispatcher entry for some providers
- whether auth routes remain framework-defined conventions or become explicit
  user-visible route handlers
- whether RSC remains part of the post-UD roadmap or is deferred until a new
  SSR core is stable

## Recommendation

Do not begin with UD plugin work or SSR migration.

Begin by making Cedar's backend Fetch-native with:

```ts
export async function handler(
  request: Request,
  ctx?: CedarRequestContext
): Promise<Response>
```

Once Cedar has that core contract and explicit backend route metadata, the
remaining UD work becomes implementation detail instead of architectural
guesswork.
