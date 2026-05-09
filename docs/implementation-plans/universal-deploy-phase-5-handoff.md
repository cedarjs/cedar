# Cedar Phase 5 — Implementation Handoff Note

**Date**: 2026-05-05
**Status**: Phase 5 implementation is functionally complete. Build passes, tests pass.
**Open architectural question**: Vite Environment API alignment.

---

## What was implemented today

### Workstream 1: Single-Listener Dev Server

- Created `packages/vite/src/apiDevMiddleware.ts` — Vite SSR dev server with inline fetch-native API dispatch. Loads functions via `ssrLoadModule`, handles GraphQL Yoga, wraps legacy Lambda handlers.
- Updated `packages/vite/src/cedar-unified-dev.ts` — one Vite dev server on a single visible port. API requests intercepted via `configureServer` middleware and dispatched through `@whatwg-node/server`'s `createServerAdapter` (public API), which handles the full `IncomingMessage → Request → Response → ServerResponse` cycle.
- **Removed**: `apiDevServer.ts` (Phase 4 Fastify-based dev server) and `cedarDevDispatcherPlugin` (Phase 4 plugin that was never installed).

### Workstream 2: buildApp() with Declared Environments

- Created `packages/vite/src/buildApp.ts` — `buildCedarApp()` uses Vite's `createBuilder().buildApp()` with declared `client` and `api` environments.
- Updated `packages/cli/src/commands/build/buildHandler.ts` — default (non-streaming-SSR) build path uses `buildCedarApp()`. Falls back to legacy separate builds when streaming SSR is enabled.
- Updated build tests to reflect unified task names.

### Cleanup

- Removed dead code (`apiDevServer.ts`, `cedarDevDispatcherPlugin` file and export).
- Removed `./apiDevServer` from `packages/vite/package.json` exports.
- Updated planning docs (`phase-5-detailed-plan.md`, `integration-plan-refined.md`, `project-overview.md`) to reflect actual implementation.

---

## Test Results

- ✅ All 90 Vite package tests pass
- ✅ All 17 relevant CLI tests pass (build + dev)
- ✅ Both `@cedarjs/vite` and `@cedarjs/cli` build successfully

---

## Important Architectural Insight (for tomorrow)

Our current implementation uses the **Vite 5-style manual middleware pattern**:

- `cedar-unified-dev.ts` creates one Vite dev server
- `apiDevMiddleware.ts` creates a **second** internal Vite SSR dev server (`createServer({ configFile: false, middlewareMode: true })`)
- Middleware delegates to a cached `createServerAdapter(apiHandler)` instance, which internally handles the `IncomingMessage → Request → Response → ServerResponse` cycle

**Vite 6+ recommends the Environment API pattern** for full-stack frameworks:

- Define `api` as a **declared Vite environment** in the dev server config
- Use `createFetchableDevEnvironment` for Fetch-native runtimes
- The environment's `handleRequest(Request)` returns `Response`
- Middleware calls `server.environments.api.dispatchFetch(request)`
- For module loading: `transformRequest(url)` returns transformed code; the runtime evaluates it

**Key difference**: `FetchableDevEnvironment` does NOT have `runner.import()` (that's `RunnableDevEnvironment`). The Fetchable model is "Vite transforms, your runtime executes" via `environment.transformRequest(url)`.

**Open question**: ~~Should Cedar refactor to `FetchableDevEnvironment`?~~ **Answer: No, not for the default Node path.**

After reading [vitejs/vite Discussion #18191](https://github.com/vitejs/vite/discussions/18191), the picture is clear:

- `FetchableDevEnvironment` is designed for **non-Node runtimes** (Cloudflare Workers, Deno, Bun edge) where the app code runs in a different process/runtime than the Vite dev server.
- Vite explicitly decided **NOT** to make the default SSR environment a `FetchableDevEnvironment`. The default SSR path is `RunnableDevEnvironment` (with `.import()` / `.runner`).
- `transformRequest(url)` is **not mentioned** in the discussion as a module-loading replacement.
- Our current approach (`createServer({ middlewareMode: true })` + `ssrLoadModule`) is functionally equivalent to `RunnableDevEnvironment` and is the correct pattern for Node.

**Conclusion**: Cedar's current implementation is architecturally sound for Node. `FetchableDevEnvironment` would only be needed if Cedar wants to support **dev-mode simulation of edge runtimes** (e.g. running API code in `workerd` locally to match Cloudflare Workers production).

**Reference**: See `docs/implementation-plans/universal-deploy-phase-5-detailed-plan.md` and `docs/implementation-plans/universal-deploy-integration-plan-refined.md` for updated Phase 5 descriptions.

---

## Next Steps (suggested)

1. Validate the single-listener dev server in `local-testing-project` (`cedar dev --ud`)
2. Validate `cedar build` produces correct output for both web and API
3. Decide whether to refactor to `FetchableDevEnvironment` or keep current approach
4. If keeping current approach: add documentation explaining the architectural choice
5. If refactoring: design module execution layer for `transformRequest` output

---

## Files Changed Today

- `packages/vite/src/apiDevMiddleware.ts` (new)
- `packages/vite/src/cedar-unified-dev.ts` (refactored)
- `packages/vite/src/buildApp.ts` (new)
- `packages/vite/src/build/build.ts` (updated)
- `packages/vite/src/index.ts` (removed exports)
- `packages/vite/package.json` (removed `./apiDevServer` export)
- `packages/cli/src/commands/build/buildHandler.ts` (refactored)
- `packages/cli/src/commands/build/__tests__/build.test.ts` (updated)
- `docs/implementation-plans/universal-deploy-phase-5-detailed-plan.md` (updated)
- `docs/implementation-plans/universal-deploy-integration-plan-refined.md` (updated)
- `docs/implementation-docs/2026-03-26-cedarjs-project-overview.md` (updated)
- Deleted: `packages/vite/src/apiDevServer.ts`
- Deleted: `packages/vite/src/plugins/vite-plugin-cedar-dev-dispatcher.ts`
