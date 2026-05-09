# Detailed Plan: Universal Deploy Phase 5 — Idiomatic Vite Full-Stack Integration

## Summary

Phase 4 delivered a working Vite-centric full-stack runtime: one `cedar dev`
command, API HMR through Vite's SSR module graph, and a Vite-built UD Node
server entry for `cedar serve`. However, the underlying architecture is an
**incremental bridge** that still deviates from what the Vite team recommends
for full-stack frameworks.

Phase 5 closes that architectural gap by making Cedar's Vite integration
**idiomatic**:

- **Dev**: one Vite dev server with a single visible port and API middleware
  inline — no separate HTTP listener for the API side
- **Build**: Vite's `buildApp()` API (or the builder `buildApp()` hook) used to
  build the **client** and **api** environments together in a single build pass,
  with environments declared in `vite.config`

This is foundational infrastructure, not a user-facing feature. It makes later
phases (per-route UD registration, SSR rebuild) simpler and more robust by
ensuring Cedar's Vite integration follows the same patterns as the rest of the
Vite full-stack ecosystem.

## Why Phase 5 Exists

Phase 4 took the shortest path to user-facing wins. It runs two HTTP listeners
in dev (web Vite server + API Vite SSR + Fastify) and uses three separate
`viteBuild()` calls in production. That was the right trade-off for Phase 4,
but it leaves technical debt that compounds if not addressed before the next
major milestones.

### Two problems to solve

**1. Two-listener dev model**

`cedar-unified-dev` starts:

- a Vite client dev server on `webPort`
- a Vite SSR dev server (`middlewareMode: true`) + Fastify on `apiPort`

The browser still conceptually targets two origins. Auth flows, CORS, and
cookie handling are more complex than they need to be because the API is not
served from the same origin as the web assets.

**2. Fragmented build pipeline**

`buildApiWithVite()`, `buildUDApiServer()`, and the web client build each call
`viteBuild()` standalone. There are three independent Vite builds with no shared
module graph, no shared transform pipeline, and no coordinated invalidation.

## Goals

### Primary Goals

- Replace the two-listener dev model with a **single Vite dev server** that
  handles both web and API requests on one visible port
- Reimplement API request handling as **Vite middleware** (via
  `configureServer` hook or equivalent) rather than a separate Fastify listener
- Adopt **`buildApp()` with declared environments** for production builds,
  replacing standalone `viteBuild()` calls for each side
- Ensure the custom Fastify compatibility lane (Lane B) is **not affected** by
  these changes

### Secondary Goals

- Preserve all existing Phase 4 dev behavior: HMR, GraphQL, auth, functions,
  GraphiQL, direct `curl`
- Maintain backward compatibility for the `cedar dev` CLI contract
- Keep build output paths stable so `cedar serve` continues to work unchanged

## Non-Goals

- Adding new user-facing features (this is an internal architecture phase)
- Changing the Cedar handler contract or middleware model
- Rebuilding SSR or RSC (that is Phase 7)
- Formalizing per-route UD registration (that is Phase 6)
- Removing the custom Fastify compatibility lane
- Supporting arbitrary Fastify plugins in the default runtime path

## Workstreams

## Workstream 1: Single-Listener Dev Server

### Objective

Move API request handling from a separate Fastify listener into the Vite dev
server's middleware pipeline.

### Current State

`apiDevServer.ts` (removed in this phase) previously created a Vite SSR dev server
(`middlewareMode: true`) and mounted a Fastify app on a separate port. The Fastify
app handled body parsing, URL data extraction, route matching, GraphQL Yoga
streaming, and content-type parsing.

### Target State

A single `createServer()` call in `cedar-unified-dev` that:

- starts one Vite dev server on the visible port
- installs inline API middleware via the `configureServer` hook
- routes API requests through `apiDevMiddleware.ts` (Vite SSR + fetch-native
  dispatch) directly inside the web server's middleware pipeline
- falls through to Vite's normal web handling for non-API requests

### Tasks

- replace Fastify routing with fetch-native request classification and dispatch
  via `apiDevMiddleware.ts`
- implement body parsing as a utility function (`nodeRequestToFetch`) rather
  than a Fastify plugin
- mount GraphQL Yoga directly inside the middleware pipeline using its
  `handle(request, context)` method, which already expects a Fetch `Request`
- preserve the `LAMBDA_FUNCTIONS` registry and HMR invalidation logic — only
  the HTTP transport layer changes
- ensure request context enrichment (cookies, params, query, auth state) still
  flows correctly without Fastify's `req`/`reply` objects
- preserve error surfacing: backend errors should still be visible in both
  terminal and HTTP response where appropriate
- remove `apiDevServer.ts` and `cedarDevDispatcherPlugin` (both superseded by
  `apiDevMiddleware.ts`)

### Blockers to Resolve

- GraphQL Yoga's `handle()` method expects a Fetch `Request` and returns a
  Fetch `Response`. This is already nearly the target shape, but the current
  code wraps it in `getAsyncStoreInstance().run()` inside a Fastify handler.
  That AsyncLocalStorage context needs to be established in the middleware
  pipeline instead.
- Legacy Lambda-shaped handlers need to be wrapped for the fetch-native path.
  `wrapLegacyHandler` from `@cedarjs/api/runtime` provides this bridge, letting
  the inline middleware treat all handlers uniformly as `CedarHandler`.

### Deliverable

- `cedar dev` runs on a single visible port with no separate API listener
- API requests (GraphQL, auth, functions) are handled inline via Vite middleware
- Web requests (assets, HMR, SPA fallback) continue through Vite's normal path

## Workstream 2: `buildApp()` with Declared Environments

### Objective

Replace the three separate `viteBuild()` invocations with a single `buildApp()`
call that declares `client` and `api` environments.

### Current State

Production build uses three standalone Vite builds:

1. `buildApiWithVite()` — builds API functions with `ssr: true` and
   `preserveModules: true`
2. `buildUDApiServer()` — builds the UD Node server entry with the
   `cedarUniversalDeployPlugin` and `node()` plugin
3. `cedar-vite-build` binary — builds the web client bundle

These share no module graph, no transform pipeline, and no invalidation.
Alias resolution, Babel plugin ordering, and externalization logic can diverge
silently.

### Target State

A unified Vite config that declares:

```ts
// Simplified illustration
export default defineConfig({
  environments: {
    client: {
      // web browser bundle (SPA assets)
      build: {
        outDir: 'web/dist',
        // ...
      },
    },
    api: {
      // server-side API entry (Cedar aggregate fetchable)
      build: {
        ssr: true,
        outDir: 'api/dist',
        // ...
      },
    },
  },
})
```

A single `buildApp()` call builds both environments from the same module graph.

### Tasks

- evaluate Vite's `buildApp()` API stability and feature completeness for Cedar's
  use case (check current Vite version support)
- merge the three existing build configurations into one unified config with
  declared environments
- ensure `node()` from `@universal-deploy/node/vite` works correctly within the
  `buildApp()` environment model
- ensure the web client build's special requirements (cwd, PostCSS/Tailwind
  resolution, etc.) are preserved in the unified config
- verify that output paths remain stable so `cedar serve` does not need changes
- add the `api` environment to the Vite config used by `cedar build`

### Blockers to Resolve

- `buildApp()` may not be fully stable or documented in the Vite version Cedar
  pins. This needs investigation before committing to the migration.
- The web client build currently runs via a separate binary
  (`cedar-vite-build`) with its own config file. That binary changes `cwd`
  to the web directory for PostCSS/Tailwind correctness. The unified build
  needs to preserve that behavior or find an alternative.

### Deliverable

- `cedar build` uses a single `buildApp()` invocation for both client and api
  environments
- Output directories and artifacts remain compatible with `cedar serve`

## Suggested Sequencing

1. **Single-listener dev first** — this is the higher-impact change for daily
   developer experience and should be validated before layering `buildApp()` on
   top of it
2. **`buildApp()` second** — the build consolidation is less user-visible and
   can be done in parallel with single-listener testing, but it should not be
   released before single-listener is stable

## Relationship to Other Phases

- **Phase 4**: this phase replaces the incremental bridge with the idiomatic
  architecture. Phase 4 must be stable before starting this work.
- **Phase 6 (UD per-route registration)**: single-listener makes per-route
  dispatch simpler because there's only one request classification layer to
  reason about. The dispatcher that routes to per-route entries is the same
  middleware that currently routes to the aggregate entry.
- **Phase 7 (SSR rebuild)**: `buildApp()` with declared environments is
  prerequisite for SSR because SSR will add a third environment (`ssr` for
  HTML streaming / RSC). The build infrastructure must already support
  multiple environments.

## Exit Criteria

- `cedar dev` runs a single Vite dev server on one visible port for the default
  runtime path
- API requests are handled inline via Vite middleware, not by a separate
  Fastify listener
- `cedar build` uses `buildApp()` with declared `client` and `api`
  environments in a single build pass
- All existing Phase 4 functionality (HMR, GraphQL, auth, functions, GraphiQL,
  direct `curl`, `cedar serve`) continues to work
- The custom Fastify compatibility lane is unaffected

## Risks

- `buildApp()` API may not be mature enough in the pinned Vite version
- Moving body parsing and request enrichment out of Fastify may surface edge
  cases in auth providers or GraphQL Yoga plugins that currently depend on
  Fastify-specific request shapes
- Single-listener dev may complicate debugging if API and web errors are
  interleaved in the same Vite server output
- The web client build's `cwd` sensitivity (PostCSS/Tailwind) may resist
  merging into a unified config

## Implementation Notes

### Why Cedar Uses `RunnableDevEnvironment` Instead of `FetchableDevEnvironment`

Vite 6+ introduced the **Environment API** with two primary dev-environment
abstractions for full-stack frameworks:

- **`RunnableDevEnvironment`** — Vite transforms code AND executes it via a
  `ModuleRunner` (`.import()` / `.runner`). This is the default for Node.js SSR.
- **`FetchableDevEnvironment`** — Vite transforms code, but the runtime executes
  it via `environment.transformRequest(url)`. The environment exposes a
  `handleRequest(Request)` method that returns `Response`. This is designed for
  non-Node runtimes (Cloudflare Workers, Deno, Bun edge) where the app code runs
  in a different process/runtime than the Vite dev server.

After evaluating both patterns against Cedar's requirements, Cedar's unified dev
server (`cedar-unified-dev`) uses **two Vite dev servers** internally:

1. A **client** dev server (standard Vite, port 8910) that serves web assets and
   runs the inline API middleware.
2. An internal **SSR** dev server (`middlewareMode: true`, no visible port) that
   loads API functions via `ssrLoadModule` and provides HMR for the API side.

This is functionally equivalent to `RunnableDevEnvironment` and is the pattern
that the Vite team explicitly recommends for **Node-based full-stack
frameworks**. The Vite core team decided **not** to make the default SSR
environment a `FetchableDevEnvironment` because `RunnableDevEnvironment` is the
correct abstraction when the dev server and the app runtime share the same Node
process.

**Conclusion**: Cedar's current approach is architecturally sound for Node.
`FetchableDevEnvironment` would only be needed if Cedar wants to support
**dev-mode simulation of edge runtimes** (e.g. running API code in `workerd`
locally to match Cloudflare Workers production). That is a future enhancement,
not a requirement for the default Node path.

Reference: [vitejs/vite Discussion #18191](https://github.com/vitejs/vite/discussions/18191)

### Default `ssr` Environment in `buildApp()`

When using Vite's `createBuilder()` with a config file that contains `build`
options, Vite automatically injects a default `ssr` environment alongside the
`client` environment. Because Cedar declares its own `api` environment (which
replaces the default `ssr` environment conceptually), the leftover default
`ssr` environment inherits the web `index.html` input and causes Vite to throw:

> "rollupOptions.input should not be an html file when building for SSR"

Cedar resolves this with a small `configResolved` plugin (`cedar-build-app-cleanup`)
that removes the redundant `ssr` environment from the resolved config before
`createBuilder()` instantiates it. This lets `buildApp()` build only the two
environments Cedar actually needs: `client` and `api`.

## Deliverables

- refactored `cedar-unified-dev` using single Vite dev server with inline API
  middleware
- refactored `cedar build` using `buildApp()` with `client` and `api`
  environments
- updated documentation reflecting the single-port dev model and unified build
