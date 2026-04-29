# Detailed Plan: Universal Deploy Phase 4 — Vite-Centric Full-Stack Dev Runtime

## Summary

Phase 4 is the point where Cedar's Universal Deploy work becomes visible in
day-to-day development. The core shift is not just "use Vite more"; it is
"make Vite the single externally visible development runtime for the whole app."

Today, Cedar development is still mentally and operationally split:

- the web side is served through Vite
- the API side runs as a separate backend process
- requests move through a proxy boundary
- backend invalidation and frontend invalidation are related, but not truly part
  of one runtime model

Phase 4 replaces that with a single dev host and a single request entrypoint
that can serve:

- web assets and HTML
- GraphQL requests
- auth requests
- server function requests
- future fetch-native backend handlers

This phase is also where the temporary Phase 3 scaffolding starts turning into a
real runtime architecture. In particular:

- Cedar dev should stop exposing a separate backend port as part of the normal
  developer experience
- the API runtime should execute inside a Vite-centric development environment
- the API server Vite build should gain the first real
  `cedarUniversalDeployPlugin()`
- `@universal-deploy/node` should be wired into the API server build and serve
  path so `cedar serve` runs the Vite-built server entry rather than the
  temporary direct server construction path

Phase 4 is still not the phase where Cedar fully formalises per-route UD entry
registration. That belongs to Phase 6. Phase 4 should intentionally ship a
working aggregate-entry model that is operationally correct for local
development and for the Node serve path.

## Why Phase 4 Exists

Phases 1-3 establish the prerequisites:

- Phase 1 makes Cedar handlers fetch-native
- Phase 2 gives Cedar a formal backend route manifest
- Phase 3 adopts UD deployment adapters and introduces temporary scaffolding

But none of that yet changes the main development experience enough. Cedar still
feels like a split system unless development itself is unified.

Phase 4 exists to solve five concrete problems:

1. **Port split**
   - Developers should not need to think in terms of "frontend port" and
     "backend port" for normal app development.

2. **Proxy split**
   - Requests should not conceptually travel from "the Vite server" to "the API
     server" as two separate application runtimes.

3. **Module graph split**
   - Backend code changes should participate in a Vite-owned invalidation and
     restart model rather than a separate watcher/process model.

4. **Serve path split**
   - `cedar serve` should move onto the same UD-oriented build output that the
     broader integration is targeting.

5. **Architecture split**
   - Cedar should stop treating the API runtime as a special non-Vite island in
     development.

## Relationship to the Refined Integration Plan

This document expands the refined plan's Phase 4 section into an implementation
plan with concrete architecture, workstreams, sequencing, risks, and acceptance
criteria.

It preserves the refined plan's key constraints:

- one visible development port
- one dev request dispatcher
- backend execution integrated into the Vite dev runtime
- strong DX for browser traffic and direct HTTP tooling
- `cedarUniversalDeployPlugin()` introduced in the API server Vite build
- `node()` from `@universal-deploy/node/vite` added to the API server Vite build
- no confusion between Vite's "SSR environment" and Cedar's HTML SSR feature

It also preserves the phase boundary:

- Phase 4 delivers a working aggregate-entry plugin and runtime
- Phase 6 expands that into full per-route registration and provider-facing
  correctness

## Goals

### Primary Goals

- Make `cedar dev` expose one externally visible host/port for the default app
  runtime
- Route web and API traffic through one development dispatcher for the default
  Cedar runtime path
- Execute Cedar-owned backend handlers in a Vite-centric runtime
- Ensure backend source changes are reflected through a coherent dev invalidation
  model
- Make `cedar serve` run the Vite-built UD Node server entry for the default
  non-custom-server path
- Introduce the first production-worthy version of
  `cedarUniversalDeployPlugin()` for the API server build
- Preserve a compatibility lane for apps that depend on custom Fastify server
  setup

### Secondary Goals

- Preserve GraphiQL and direct `curl` workflows
- Preserve existing auth and function behavior during the transition
- Minimise app-level migration burden
- Keep Phase 4 compatible with the later Phase 6 route-registration expansion
- Make the compatibility story for `api/src/server.{ts,js}`,
  `configureFastify`, and custom Fastify plugins explicit

## Non-Goals

Phase 4 should explicitly not try to do all of the following:

- rebuild Cedar HTML SSR or RSC
- formalise per-route UD registration for all providers
- redesign Cedar's web-side production serving model
- solve every provider-specific deployment concern
- remove all transitional compatibility layers introduced earlier
- merge web and API build outputs into one universal production artifact
- introduce a new public app authoring API unless required for runtime
  correctness
- remove the custom Fastify server path for apps that already depend on it
- force all existing Fastify-specific customisations onto the new runtime in
  this phase

## Current Baseline Before Phase 4

Based on the current Cedar architecture, the refined integration plan, and the
current codebase, the baseline is:

- web development is Vite-centric
- API development is still conceptually separate
- `cedar dev` still starts separate web and API jobs
- the current web/API relationship still assumes a proxy-oriented model in
  important places
- production API serving has a temporary UD-oriented path
- Cedar already has or is expected to have:
  - fetch-native handlers
  - a backend route manifest
  - temporary UD scaffolding
- `cedar serve api --ud` or equivalent transitional paths exist, but they are
  not yet the default unified runtime story
- Cedar still has a real, supported Fastify customisation surface through
  `api/src/server.{ts,js}`, `configureApiServer`, and older
  `configureFastify`-style configuration
- the current UD dispatcher is an aggregate Cedar API dispatcher, but it is not
  yet a complete replacement for arbitrary Fastify custom routes, hooks,
  decorators, or plugins

This means Phase 4 is not starting from zero. It is integrating already-created
pieces into a coherent dev runtime while preserving a compatibility path for
apps that depend on Fastify-specific server customisation.

## Codebase Alignment Notes

The current codebase already supports the main direction of this phase:

- temporary UD scaffolding exists specifically to be removed in Phase 4
- a shared aggregate Cedar dispatcher already exists and is intended to be used
  by both the temporary server path and the future Vite virtual module path
- the CLI already marks the current UD serve path as transitional
- the current dev model is still clearly split between web and API processes

At the same time, the codebase also makes two important constraints visible:

1. The current aggregate UD dispatcher is still narrower than the final Phase 4
   target. It already handles Cedar-owned API surfaces such as GraphQL and
   filesystem-discovered functions, but it should not be treated as proof that
   all Fastify-based customisation has already been subsumed by the fetch-native
   runtime.
2. Cedar currently exposes a real Fastify customisation surface. That means
   Phase 4 cannot be treated as a blanket removal of Fastify from every app
   runtime path without breaking supported user setups.

These constraints shape the recommended implementation approach for this phase:
the unified Vite-centric runtime becomes the default path for standard Cedar
apps, while custom-server apps remain on an explicit compatibility lane until a
later migration path exists.

## Architectural Target for Phase 4

### High-Level Shape

After Phase 4, the default development architecture should look like this:

- one Vite-hosted dev server is externally visible
- that dev server owns the request entrypoint
- browser-facing web requests are handled by Vite as usual
- API-like requests are dispatched into Cedar's fetch-native backend runtime
- backend modules are loaded through a Vite-aware mechanism rather than a
  completely separate long-lived backend process
- the API server build has a Vite config that:
  - installs `cedarUniversalDeployPlugin()`
  - installs `node()` from `@universal-deploy/node/vite`
  - emits a self-contained Node server entry for `cedar serve`

For apps with custom Fastify setup, Phase 4 should preserve a compatibility
lane rather than forcing them onto the default unified runtime immediately.
Those apps may continue to use a custom-server path until Cedar provides a
framework-agnostic replacement for the Fastify-specific extension points they
depend on.

### Conceptual Request Flow in Dev

The intended request flow is:

1. request arrives at the single Vite dev host
2. Cedar dev middleware classifies the request
3. request is dispatched to one of:
   - Vite static/HMR/web handling
   - GraphQL handler
   - auth handler
   - function handler
   - aggregate Cedar API dispatcher
4. response is returned directly from the same host

The important change is that the browser, GraphQL clients, auth callbacks, and
CLI HTTP tooling all target the same visible origin.

### Conceptual Build/Serve Flow

For `cedar serve`, the intended flow is:

1. API server Vite config builds the server entry
2. `cedarUniversalDeployPlugin()` registers Cedar's aggregate API entry
3. `node()` from `@universal-deploy/node/vite` produces the Node-compatible
   server output
4. `cedar serve` launches that built server entry

This completes the move away from the temporary direct server construction path
for the Node serve case.

## Design Principles for This Phase

### 1. Vite Owns the Dev Host

The visible development host should be Vite's host, not a wrapper process that
merely proxies to Vite. Cedar may compose middleware around Vite, but the
developer mental model should still be "the app runs on one Vite dev server."

### 2. Cedar Owns Request Classification

Vite should remain the host, but Cedar should own the logic that decides whether
a request is:

- a frontend asset/HMR request
- a page/document request
- a GraphQL request
- an auth request
- a server function request
- a fallback request

This keeps Cedar's routing and runtime contract authoritative.

### 3. Fetch-Native Execution Is the Runtime Center

Backend execution should happen through Cedar's fetch-native handler contract,
not through reintroduced Node/Express/Fastify-specific request objects.

### 4. Aggregate Entry First, Per-Route Later

Phase 4 should use one aggregate Cedar API entry for correctness and speed of
delivery. It should not prematurely implement the full Phase 6 route-splitting
model.

### 5. No Cedar/SSR Terminology Drift

Any Vite config or code comments must clearly distinguish:

- Vite "SSR" meaning server-side module execution/build target
- Cedar "SSR" meaning HTML server rendering / streaming / RSC-related behavior

This distinction matters because the API server build will use Vite's server
build machinery without implying Cedar HTML SSR.

### 6. Preserve Existing App Contracts Where Possible

App authors should not need to rewrite routes, functions, GraphQL handlers, or
auth setup just to adopt Phase 4.

### 7. Preserve a Compatibility Lane for Custom Fastify Apps

Apps that use `api/src/server.{ts,js}`, `configureApiServer`,
`configureFastify`, or direct `server.register(...)` Fastify plugin setup are
using a supported Cedar extension path today. Phase 4 should not silently
bypass or ignore those customisations.

Instead, the default unified runtime should apply to standard Cedar apps, while
custom-server apps remain on an explicit compatibility lane until Cedar offers a
clear migration path to framework-agnostic extension points.

## Vite Architecture Alignment

The Vite team recommends a specific architecture for full-stack frameworks:

- **Dev**: a **single** Vite dev server with an API middleware mounted directly on it. API requests hit the same origin/port as the web dev server and are handled inline by Vite middleware — no separate HTTP listener for the API.
- **Build**: Vite's **`buildApp`** API (or the builder `buildApp()` hook) used to build the **client** and **SSR/custom** environments together in a single build pass, with environments declared in `vite.config`.

### Current Implementation Gap

The Phase 4 implementation as it exists today is an **incremental step** toward that architecture, but it does not yet match it:

- **Dev**: `cedar-unified-dev` still runs **two HTTP listeners** in one Node process:
  1. A Vite SSR dev server (`middlewareMode: true`) + a Fastify app listening on `apiPort`
  2. A regular Vite client dev server listening on `webPort`
     This means the browser still conceptually targets two ports, even though they are orchestrated by one CLI command.
- **Build**: `buildApiWithVite()` calls `viteBuild()` **standalone** for the API side. It does not yet use `buildApp()` or the builder API with declared environments. Web and API are built as two separate Vite invocations, not as coordinated environments within one `buildApp` pass.

This is acceptable for Phase 4 because it delivers the core operational wins (one CLI command, Vite module graph for API code, HMR) without requiring a full rewrite of the dev server composition. A future phase should close the gap by moving to a true single-listener Vite dev server with inline API middleware, and by adopting `buildApp()` with client + API environments.

## Proposed Runtime Architecture

## 1. Dev Runtime Composition

The Phase 4 dev runtime should be composed from three layers:

### Layer A: Vite Dev Server

Responsibilities:

- static asset serving
- HMR
- HTML transforms
- frontend module graph ownership
- browser-facing dev ergonomics

### Layer B: Cedar Dev Request Dispatcher

Responsibilities:

- classify incoming requests
- decide whether Cedar backend handling should run
- invoke the aggregate Cedar API fetch dispatcher when appropriate
- fall through to Vite web handling when appropriate

This is the key new Phase 4 layer.

### Layer C: Cedar Aggregate API Runtime

Responsibilities:

- execute GraphQL
- execute auth endpoints
- execute filesystem-discovered functions
- execute any other Cedar-owned fetch-native backend entries included in the
  aggregate dispatcher

This layer should be built on the Phase 1 and Phase 2 contracts, not on legacy
event-shaped APIs.

### Important Scope Note

In the current codebase, the aggregate UD dispatcher should be treated as the
Cedar-owned backend runtime path, not as a complete replacement for arbitrary
Fastify customisation. Phase 4 should unify Cedar's default runtime path first,
while preserving a separate compatibility lane for apps that depend on
Fastify-specific hooks, decorators, routes, or plugins.

## 2. Request Classification Model

The dispatcher should classify requests in a deterministic order. A practical
order is:

1. Vite internal requests
   - HMR endpoints
   - Vite client assets
   - transformed module requests
2. explicit API endpoints
   - GraphQL
   - auth
   - function routes
3. web asset requests
   - static files
   - known web assets
4. page/document requests
   - app routes that should return the web app shell in SPA mode
5. fallback/error handling

The exact path patterns should come from Cedar configuration and route manifest
data where possible, not from scattered hardcoded checks.

### Why Ordering Matters

Ordering mistakes can create subtle bugs:

- Vite HMR requests accidentally routed into Cedar API handling
- GraphQL requests falling through to SPA HTML
- auth callback routes being treated as frontend routes
- static assets being intercepted by API logic

Phase 4 should therefore define request classification as a first-class runtime
concern, not an incidental middleware detail.

## 3. Backend Execution Model in Dev

There are two broad implementation styles Cedar could take:

### Option A: In-Process Vite Middleware Execution

Cedar installs middleware into the Vite dev server and directly invokes the
aggregate fetch dispatcher from there.

**Pros**

- simplest mental model
- one visible server
- minimal extra process orchestration
- easiest path to "one dispatcher"

**Cons**

- backend invalidation semantics must be handled carefully
- Node-only backend dependencies must coexist with Vite's server runtime model
- error isolation may be weaker than a separate worker model

### Option B: Vite-Owned Host with Internal Backend Worker

Cedar still exposes one visible Vite host, but backend execution happens in an
internal worker/sub-runtime managed by the dev system.

**Pros**

- stronger isolation
- potentially cleaner backend reload semantics

**Cons**

- more moving parts
- easier to accidentally recreate the old split model internally
- more complexity for Phase 4 than likely necessary

### Recommendation

Phase 4 should prefer **Option A** unless implementation evidence proves it
unworkable. The refined plan already points toward Vite middleware integration,
and that is the shortest path to the intended developer experience.

If isolation issues appear, they should be documented as follow-up work rather
than causing Phase 4 to balloon into a multi-runtime orchestration project.

## 4. Backend Invalidation and Reload Strategy

This is one of the most important implementation details.

The backend runtime must respond correctly to changes in:

- `api/src/functions/**`
- `api/src/graphql/**`
- `api/src/services/**`
- auth-related backend modules
- route manifest inputs
- generated artifacts that affect backend execution

### Required Outcomes

- code changes should be reflected without requiring manual process restarts
- stale backend modules should not remain cached indefinitely
- errors should surface clearly in the terminal and browser/client responses
- invalidation should be targeted enough to avoid unnecessary full reloads when
  possible

### Practical Strategy

Phase 4 should start with a conservative invalidation model:

- treat the aggregate Cedar API runtime as a reloadable server module boundary
- when backend-relevant files change, invalidate the aggregate backend entry and
  its dependent modules
- rebuild or re-import the backend dispatcher through Vite's server module
  system
- prefer correctness over maximal granularity

This is another place where Phase 6 can later improve precision once per-route
entries exist.

### Important Constraint

Do not try to make backend invalidation mirror frontend HMR exactly. Backend
execution correctness matters more than preserving stateful hot replacement
semantics.

## 5. Aggregate API Entry Shape

Phase 4 should introduce a single aggregate virtual entry, likely represented by
`virtual:cedar-api`.

That virtual module should:

- import the Cedar API dispatcher construction logic
- build the aggregate fetchable from Cedar's route/function/GraphQL/auth sources
- export the aggregate fetchable as the default export

This entry is the bridge between Cedar's runtime model and UD's Vite/plugin
model.

### Why Aggregate Entry Is Correct for Phase 4

An aggregate entry:

- keeps plugin complexity manageable
- avoids premature provider-specific route splitting
- is sufficient for local dev and Node serve
- aligns with the refined plan's explicit Phase 4/Phase 6 boundary

## 6. `cedarUniversalDeployPlugin()` Responsibilities in Phase 4

The plugin introduced in this phase should do exactly the minimum needed for a
working system on the default Cedar runtime path.

### Required Responsibilities

- register `virtual:cedar-api` with the UD store via `addEntry()`
- resolve `virtual:ud:catch-all` to `virtual:cedar-api`
- emit the virtual module that exports Cedar's aggregate API fetchable
- operate in the API server Vite build, not the web client build

### Explicit Non-Responsibilities in Phase 4

- registering every Cedar route as a separate UD entry
- becoming the final provider-facing route metadata source
- handling web-side route registration comprehensively
- solving all adapter-specific optimisations

### Package Boundary Implication

Because the virtual module imports API-server runtime code,
`@cedarjs/vite` should declare `@cedarjs/api-server` as a `peerDependency`,
matching the refined plan.

## 7. `@universal-deploy/node` Integration in Phase 4

The API server Vite build should add `node()` from
`@universal-deploy/node/vite`.

### Purpose

- produce a self-contained Node server entry
- let `cedar serve` run the built output
- replace the temporary direct server construction path for the Node serve case

### Important Clarification

This is a Vite server build concern, not a Cedar HTML SSR concern.

Any implementation notes, config names, comments, and docs should repeatedly
make this clear to avoid future confusion.

## Runtime Lanes in Phase 4

Phase 4 should explicitly support two runtime lanes.

### Lane A: Default Unified Runtime

This is the primary Phase 4 target for standard Cedar apps:

- one visible Vite-hosted dev port
- one Cedar dev request dispatcher
- Cedar-owned backend execution through the aggregate fetch-native runtime
- API server Vite build integrated with `cedarUniversalDeployPlugin()`
- `cedar serve` running the Vite-built UD Node server entry

### Lane B: Custom Fastify Compatibility Runtime

This lane exists for apps that depend on Cedar's current Fastify-specific server
extension points, including:

- `api/src/server.{ts,js}`
- `configureApiServer`
- `configureFastify`
- direct `server.register(...)` plugin setup
- custom Fastify routes, hooks, decorators, parsers, or reply/request behavior

For these apps, Phase 4 should preserve a supported compatibility path rather
than forcing immediate migration.

### Runtime Selection Rule

The implementation should treat the presence of a custom server path as a
meaningful runtime distinction. If an app is using a custom server entry or
Fastify-specific setup, Cedar should either:

- keep that app on the compatibility lane automatically, or
- fail clearly with guidance rather than silently dropping custom behaviour

Silent partial compatibility is the worst outcome here.

### The Default Production Path Has No Fastify

An important implication of Lane A is that **there is no Fastify in production on the default path**. When `cedar serve` runs the Vite-built output through `@universal-deploy/node`, the HTTP server is `srvx` (WinterTC-compatible), not Fastify. There is no `server.register()`, no Fastify plugin system, and no reply/request lifecycle to hook into.

This means:

- **Fastify plugins are not portable to the default lane**. A user who needs a Fastify-specific plugin must either write an equivalent as Cedar middleware (see Phase 1 middleware model) or stay on Lane B (custom Fastify compatibility).
- **Deployment-level concerns belong to the UD adapter**, not the Cedar app. Compression, TLS termination, rate limiting, edge headers, and static file serving are the responsibility of `@universal-deploy/node` (or the relevant cloud adapter), not `handleRequest()`.

### Testing Deployment Concerns: `cedar dev` vs `cedar serve`

Because deployment-level behavior lives in the UD adapter, it is **not exercised during `cedar dev`** on the default lane. The Vite dev server runs app logic only. If a user wants to verify that compression is active, that CORS headers are correct, or that the static asset pipeline behaves as expected in production, they must run **`cedar serve`**.

This represents a mental model shift from the old architecture:

|                               | Old architecture          | New default architecture                    |
| ----------------------------- | ------------------------- | ------------------------------------------- |
| **Dev**                       | Fastify (app + plugins)   | Vite (app logic only)                       |
| **Production**                | Fastify (app + plugins)   | UD adapter (`srvx` + Cedar `fetch` handler) |
| **Where to test compression** | `cedar dev` (same server) | `cedar serve` (adapter layer)               |

If this split proves too painful in practice, Cedar can add optional dev conveniences (e.g. a compression middleware in the dev dispatcher), but that should be explicitly framed as a dev aid, not the production code path.

## Workstreams

## Workstream 1: Inventory and Stabilise Existing Dev Entry Logic

### Objective

Understand and isolate the current `cedar dev` orchestration points so Phase 4
can replace the split runtime without regressing unrelated behavior.

### Tasks

- identify the current web dev startup path
- identify the current API dev startup path
- identify where proxying between web and API currently happens
- identify how GraphQL, auth, and functions are currently mounted in dev
- identify current file watching and restart behavior for backend code
- identify any assumptions in CLI output, port reporting, or generated URLs that
  depend on separate web/API ports
- identify all current custom-server and Fastify-specific extension points that
  must remain supported on the compatibility lane
- identify where `serverFileExists()` and related custom-server branching
  already exist so Phase 4 can build on those distinctions rather than fighting
  them

### Deliverable

A concrete map of the current dev orchestration points and the minimum set of
places that must change.

### Notes

This work should be done before major implementation begins. Phase 4 will be
much riskier if the current split behavior is only partially understood.

## Workstream 2: Define the Dev Request Dispatcher Contract

### Objective

Create a clear internal contract for the single dev dispatcher.

### Proposed Internal Contract

The dispatcher should accept:

- the incoming request
- enough runtime context to classify the request
- access to the aggregate Cedar API fetch handler
- access to Vite's fallback handling path

And it should return either:

- a completed response
- a signal to continue into Vite web handling

### Tasks

- define request classification inputs
- define the fallback contract to Vite
- define error handling behavior
- define logging behavior for classified requests
- define how direct HTTP requests should appear in logs and diagnostics

### Deliverable

An internal dispatcher API that can be tested independently of the full CLI
startup path.

## Workstream 3: Build the Aggregate Cedar API Runtime for Dev

### Objective

Create the aggregate fetch-native backend runtime that the dispatcher will call
for the default Cedar runtime path.

### Tasks

- compose GraphQL handling into the aggregate runtime
- compose auth handling into the aggregate runtime
- compose filesystem-discovered function handling into the aggregate runtime
- ensure route matching uses the Phase 2 route manifest or equivalent canonical
  route data
- ensure request context enrichment still works correctly
- ensure cookies, params, query, and auth state are available through the new
  fetch-native path
- explicitly document that this aggregate runtime covers Cedar-owned backend
  surfaces and is not yet a general replacement for arbitrary Fastify plugins or
  custom Fastify routes

### Deliverable

A single backend fetch dispatcher that can answer all Cedar API requests in dev.

### Validation Questions

- Does GraphiQL still load correctly?
- Do auth callback flows still work?
- Do function routes preserve method handling and path params?
- Do direct `curl` requests behave the same as browser-originated requests?

## Workstream 4: Integrate Backend Execution into the Vite Dev Runtime

### Objective

Mount Cedar backend handling into the Vite dev server so one visible host serves
the whole app on the default runtime lane.

### Tasks

- install Cedar middleware into the Vite dev server
- intercept and classify requests before SPA fallback handling
- invoke the aggregate Cedar API runtime for backend requests
- fall through to Vite for frontend requests
- ensure Vite internal endpoints are never intercepted incorrectly
- ensure response streaming and headers are preserved correctly where relevant
- ensure this integration is only the default path for standard apps, not a
  silent override of custom Fastify server setups

### Deliverable

A working one-port dev runtime.

### Key Acceptance Checks

- opening the app in the browser works
- GraphQL requests to the visible dev host work
- auth endpoints on the visible dev host work
- function endpoints on the visible dev host work
- HMR still works
- GraphiQL still works

## Workstream 5: Implement Backend Invalidation and Watch Behavior

### Objective

Ensure backend changes are reflected reliably during development.

### Tasks

- identify backend-relevant file globs
- hook those changes into Vite-aware invalidation
- invalidate the aggregate backend entry on relevant changes
- ensure generated artifacts that affect backend execution also trigger reload
  behavior
- surface backend reload events in logs for debugging

### Deliverable

Reliable backend code refresh without manual restarts in normal workflows.

### Minimum Acceptable Behavior

If a backend file changes, the next matching request should execute updated code
without requiring the developer to restart `cedar dev`.

## Workstream 6: Introduce `cedarUniversalDeployPlugin()` in the API Server Vite Build

### Objective

Create the first real Cedar UD Vite plugin implementation.

### Tasks

- add the plugin to the API server Vite build config
- register `virtual:cedar-api` with UD via `addEntry()`
- resolve `virtual:ud:catch-all` to `virtual:cedar-api`
- emit the virtual module that exports the aggregate Cedar API fetchable
- ensure the plugin only applies in the API server build context
- add the `@cedarjs/api-server` peer dependency to `@cedarjs/vite`

### Deliverable

A working plugin that bridges Cedar's aggregate API runtime into UD's Vite entry
model.

### Important Guardrail

Do not let this plugin accidentally become coupled to browser build concerns.
Its job in Phase 4 is server-entry registration for the API server build.

## Workstream 7: Wire `@universal-deploy/node` into the API Server Build and Serve Path

### Objective

Make `cedar serve` run the Vite-built Node server entry.

### Tasks

- add `node()` from `@universal-deploy/node/vite` to the API server Vite build
- ensure the build output is self-contained enough for `cedar serve`
- update `cedar serve` to launch the built server entry
- remove or bypass the temporary direct `createUDServer`-style path for the Node
  serve case
- verify startup, shutdown, logging, and error reporting behavior

### Deliverable

`cedar serve` runs the UD Node build output end-to-end.

### Acceptance Checks

- `cedar serve` starts successfully from the built output
- GraphQL works
- auth works
- functions work
- direct HTTP requests work
- no Fastify-specific production path is required for this serve mode

## Workstream 8: CLI and DX Cleanup

### Objective

Make the new runtime feel intentional rather than transitional, while making the
compatibility lane explicit for custom-server apps.

### Tasks

- update CLI startup messaging to show one visible port for the default runtime
- remove or reduce references to separate web/API dev ports in normal output for
  standard apps
- update any generated URLs, docs, or help text that assume proxying
- ensure error messages mention the unified host where appropriate
- ensure debugging output still makes it clear whether a request was handled by
  Vite web logic or Cedar backend logic
- add explicit messaging for custom-server apps so users understand when Cedar
  is using the compatibility lane instead of the default unified runtime

### Deliverable

A coherent developer experience that matches the new architecture.

## Implementation Sequence

A practical implementation order is:

### Step 1: Runtime Mapping

Complete Workstream 1 and document the current orchestration points.

### Step 2: Dispatcher Contract

Define and implement the internal dev request dispatcher contract.

### Step 3: Aggregate Backend Runtime

Build the aggregate Cedar API fetch dispatcher and validate it outside the full
Vite integration if possible.

### Step 4: Vite Dev Integration

Mount the dispatcher into the Vite dev server and get one-port request handling
working.

### Step 5: Invalidation

Add backend file invalidation and reload behavior.

### Step 6: UD Plugin

Introduce `cedarUniversalDeployPlugin()` in the API server Vite build.

### Step 7: Node Serve Integration

Add `node()` and switch `cedar serve` to the built server entry.

### Step 8: DX Cleanup and Documentation

Update CLI messaging, docs, and migration notes.

This order reduces risk by proving the runtime model before tightening the build
and serve integration.

## Testing Strategy

## 1. Unit-Level Testing

Test the request dispatcher in isolation.

### Cases

- Vite internal request is passed through
- GraphQL request is routed to backend runtime
- auth request is routed to backend runtime
- function request is routed to backend runtime
- SPA/document request falls through to web handling
- unknown request gets the correct fallback behavior

## 2. Integration Testing for Dev Runtime

Test the unified dev host end-to-end for the default runtime lane.

### Cases

- browser loads app from one port
- GraphQL POST works against same host
- GraphiQL loads from same host
- auth callback route works against same host
- function route works against same host
- static assets still load
- HMR still functions after frontend edits
- backend code changes are reflected on next request

## 3. Serve-Path Testing

Test the Vite-built Node server output for the default runtime lane.

### Cases

- `cedar serve` starts from built output
- GraphQL works
- auth works
- functions work
- route params and query parsing work
- cookies and headers are preserved correctly

## 4. Regression Testing

Focus on areas most likely to break:

- auth providers with callback flows
- GraphiQL tooling
- function routes with non-GET methods
- middleware ordering
- generated route manifest changes
- direct `curl` requests without browser headers
- custom-server apps that use `api/src/server.{ts,js}`
- Fastify plugin registration and custom Fastify routes on the compatibility
  lane

## Suggested Milestones

## Milestone A: Aggregate Backend Runtime Works

Success means:

- one aggregate fetch dispatcher exists
- GraphQL, auth, and functions all work through it
- it can be invoked independently of the final Vite integration

## Milestone B: One-Port Dev Host Works

Success means:

- browser, GraphQL, auth, and functions all work from one visible host
- Vite HMR still works
- no separate backend port is required for normal use

## Milestone C: Backend Reload Works Reliably

Success means:

- backend edits are reflected without manual restart
- stale module behavior is not observed in normal workflows

## Milestone D: `cedar serve` Uses UD Node Output

Success means:

- API server Vite build emits the server entry
- `cedar serve` launches it successfully
- the temporary direct server path is no longer needed for the Node serve case

## Risks and Mitigations

## Risk 1: Vite Internal Requests Are Misclassified

### Impact

HMR or module loading breaks in confusing ways.

### Mitigation

- classify Vite internal requests first
- add explicit tests for Vite-specific paths
- add debug logging around request classification during development

## Risk 2: Backend Module Invalidation Is Incomplete

### Impact

Developers see stale backend behavior and lose trust in the runtime.

### Mitigation

- start with coarse invalidation at the aggregate entry boundary
- prefer correctness over fine-grained optimisation
- log backend invalidation events during early rollout

## Risk 3: Auth Flows Regress

### Impact

Login/logout/callback behavior breaks, often only in certain providers.

### Mitigation

- explicitly test callback-style providers
- test cookie-based and token-based auth paths
- preserve existing request context enrichment semantics

## Risk 4: GraphiQL or Direct HTTP Tooling Regresses

### Impact

Developer workflows become worse even if browser flows work.

### Mitigation

- treat GraphiQL and `curl` as first-class acceptance cases
- test non-browser requests explicitly
- avoid assumptions that all requests originate from the SPA

## Risk 5: Phase 4 Accidentally Expands into Phase 6

### Impact

Delivery slows down because the team tries to solve per-route provider
registration too early.

### Mitigation

- keep the aggregate-entry boundary explicit
- defer per-route UD registration to Phase 6
- document temporary limitations clearly

## Risk 6: Terminology Confusion Around "SSR"

### Impact

Future maintainers wire `node()` into the wrong Vite config or conflate API
server builds with Cedar HTML SSR.

### Mitigation

- document the distinction repeatedly
- use precise naming in config and comments
- avoid ambiguous labels like "SSR build" without qualification

## Risk 7: Custom Fastify Behaviour Is Silently Lost

### Impact

Apps that rely on `api/src/server.{ts,js}`, `configureFastify`,
`configureApiServer`, or direct Fastify plugin registration appear to start, but
some custom routes, hooks, parsers, decorators, or request/reply behaviour stop
working.

### Mitigation

- preserve an explicit compatibility lane for custom-server apps
- detect custom-server usage and branch intentionally
- never silently route custom-server apps through the default unified runtime if
  that would drop supported behaviour
- document the boundary between Cedar-owned fetch-native runtime support and
  Fastify-specific compatibility support

## Open Design Questions to Resolve During Implementation

These do not block writing the plan, but they should be resolved early in
implementation:

1. What is the exact internal API between the dispatcher and Vite fallback
   handling?
2. Which backend file changes should trigger aggregate invalidation directly, and
   which should rely on dependency tracking?
3. How should backend runtime errors be surfaced in dev:
   - terminal only
   - HTTP response only
   - both
4. Should the aggregate backend runtime be lazily initialised on first request
   or eagerly prepared at dev startup?
5. Are there any auth providers that currently depend on assumptions about a
   separate backend origin?
6. Does GraphiQL require any path or asset handling adjustments when moved fully
   behind the unified host?
7. What is the cleanest migration path for any existing CLI flags or docs that
   expose separate dev ports?
8. What is the exact runtime-selection rule for deciding when an app stays on
   the custom Fastify compatibility lane?
9. Should custom-server apps keep the current split dev model in Phase 4, or is
   there a safe compatibility wrapper that still preserves Fastify behaviour?
10. Which current Fastify extension points need a future framework-agnostic
    replacement, and which should remain explicitly serverful-only?
11. What is the migration path from the current two-listener dev model
    (`webPort` + `apiPort`) to the Vite-recommended single-listener model with
    inline API middleware? Is this a Phase 4 follow-up, or does it belong to
    Phase 6?
12. When should Cedar adopt `buildApp()` with declared `client` and `api`
    environments instead of separate `viteBuild()` calls for each side?

## Exit Criteria for Phase 4

Phase 4 should be considered complete when all of the following are true:

- `cedar dev` exposes one externally visible host/port for the default runtime
  path
- GraphQL requests work directly against that host on the default runtime path
- auth requests work directly against that host on the default runtime path
- function requests work directly against that host on the default runtime path
- browser app loading and HMR still work on the default runtime path
- backend code changes are reflected without manual restart in normal workflows
  on the default runtime path
- the API server Vite build includes `cedarUniversalDeployPlugin()`
- the API server Vite build includes `node()` from
  `@universal-deploy/node/vite`
- `cedar serve` runs the Vite-built Node server entry for the default runtime
  path
- Cedar no longer depends on a separately exposed backend port for the standard
  dev experience
- custom-server apps still have a documented and supported compatibility path
- the implementation does not require Cedar HTML SSR/RSC work to be complete

## Deliverables

Phase 4 should produce the following concrete outputs:

- unified one-port dev runtime for the default Cedar runtime lane
- internal dev request dispatcher
- aggregate Cedar API fetch dispatcher for dev
- backend invalidation/reload behavior integrated with the Vite-centric runtime
- initial `cedarUniversalDeployPlugin()` in `@cedarjs/vite`
- `@cedarjs/api-server` peer dependency declared by `@cedarjs/vite`
- API server Vite build wired with `node()` from `@universal-deploy/node/vite`
- `cedar serve` updated to run the built Node server entry for the default
  runtime lane
- documented compatibility lane for apps using custom Fastify server setup
- updated docs and CLI messaging reflecting both the unified runtime and the
  compatibility lane

## Recommendation

Implement Phase 4 as a runtime unification phase, not as a provider-expansion
phase.

The most important outcome is that Cedar development becomes operationally
single-host and architecturally Vite-centric on the default runtime lane, while
`cedar serve` moves onto the UD Node build output for that same lane. If that is
achieved with an aggregate API entry and conservative backend invalidation,
Phase 4 is successful.

That success condition should not require Cedar to immediately eliminate the
custom Fastify server path. Existing apps that depend on `api/src/server.{ts,js}`
or Fastify-specific plugin setup should remain supported through an explicit
compatibility lane. Phase 6 and later work can then build on a stable default
runtime foundation while separately addressing longer-term migration away from
Fastify-specific extension points where appropriate.

Phase 5 closes the architectural gap between Phase 4's incremental bridge and
an idiomatic Vite full-stack integration. See
`universal-deploy-phase-5-detailed-plan.md` for details.
