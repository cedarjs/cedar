# Streaming SSR Rewrite: Fetch-Native Handler + Universal Deploy

**Date:** 2026-07-20 **Author:** Tobbe (with Claude) **Status:** Proposal

Companion to
[2026-07-18-prerender-rewrite.md](./2026-07-18-prerender-rewrite.md) (SSG) and
[2026-07-20-rsc-rewrite.md](./2026-07-20-rsc-rewrite.md) (RSC). This plan covers
the request-time side: rewriting Cedar's experimental streaming-SSR support on
top of a Web-standard fetch handler, Vite's Environment API, and the Universal
Deploy (`--ud`) pipeline — and off of Express.

**Strategic positioning (added 2026-07-20):** this plan is **stage B of Cedar's
rendering migration gradient** (full frame in the RSC plan): first-class SSR for
today's client-rendered Apollo apps, which paying customers need now — not
legacy maintenance. Its serving/build tracks (Fetchable contract,
srvx/Fastify/UD hosting, environments, dev unification) are additionally the
**shared substrate the RSC rewrite runs on**, which is why they sequence before
RSC v1. The web Fetchable this plan introduces is the permanent slot: its
internal router later becomes the per-route dispatcher that sends each route to
its renderer (SPA shell, Apollo streaming SSR, or RSC flight→HTML), letting one
app sit between stages.

---

## Background

Streaming SSR is gated behind `[experimental.streamingSsr] enabled = true` and
currently lives almost entirely in `@cedarjs/vite`:

- **Prod server:** `packages/vite/src/runFeServer.ts` — an **Express** app:
  `express.static` for assets, `http-proxy-middleware` to proxy `web.apiUrl` to
  the api-server, and the React render handler mounted via
  `@whatwg-node/server`'s `createServerAdapter`.
- **Dev server:** `packages/vite/src/devFeServer.ts` — a second Express app
  wrapping a Vite middleware-mode server (plus an entire second RSC-only Vite
  server).
- **Render core:** `packages/vite/src/streaming/streamHelpers.ts` +
  `createReactStreamingHandler.ts` — `renderToReadableStream` from
  `react-dom/server.edge`, the user's `Document.tsx` as the HTML shell, stream
  transforms (buffering, server-injected HTML, timeout), bot detection via
  `isbot` for render-everything-first responses.
- **Data layer:** `packages/web/src/apollo/suspense.tsx` —
  `@apollo/client-react-streaming`'s
  `WrapApolloProvider(buildManualDataTransport(...))`, with cache chunks
  injected into the stream through Cedar's `ServerHtmlContext` /
  `useServerInsertedHTML`. A Vite plugin (`vite-plugin-swap-apollo-provider.ts`)
  rewrites `@cedarjs/web/apollo` imports to the suspense provider when streaming
  is enabled.
- **Build:** `packages/vite/src/buildFeServer.ts` → `buildForStreamingServer.ts`
  — a plain `viteBuild({ build: { ssr: true } })` into `web/dist/ssr`, predating
  the Environment API, orchestrated by its own branch in the CLI's
  `buildHandler.ts`.

What's wrong with it, in order of severity:

- **It is architecturally stranded.** Universal Deploy went a different (and
  better) direction: Web-standard fetch handlers, built through Vite
  environments (`buildCedarApp` in `packages/vite/src/buildApp.ts`), served
  in-process by **srvx**, split into provider functions by
  `@universal-deploy/*` + provider Vite plugins. Streaming SSR is explicitly
  mutually exclusive with all of it — build, dev, and serve each gate on
  `streamingSsr` being disabled, with "Phase 7 (SSR/RSC rebuild) will address
  unifying this path" TODOs. This plan is that phase.
- **Express.** Two Express servers, `http-proxy-middleware`, and an
  Express→Fetch adapter — all to host handlers that are already Fetch-native
  inside. The rest of Cedar's serving story (UD serve, api Fetchables) has moved
  to Web standards; the streaming servers are the last Express holdouts.
- **RSC entanglement.** `streamHelpers.ts` branches on `rscEnabled` seven times;
  the `importModule()` indirection exists only for RSC's bundled
  single-React-instance requirement; `devFeServer.ts` hosts an entire RSC-only
  Vite server. The RSC build is being removed and rewritten from scratch, so
  none of this should be preserved — but today it is load-bearing scaffolding
  around the streaming path.
- **Drift and duct tape.** The suspense Apollo provider is a fork of the (now
  deprecated) `RedwoodApolloProvider` rather than of the new
  `CedarApolloProvider`; the render timeout is hardcoded to 10s; 404s throw
  instead of rendering; `runFeServer.ts` carries TODOs about moving to a server
  package that never happened.

What's **right** with it — and carried forward:

- `renderToReadableStream` + Web Streams as the render primitive.
- `Document.tsx` as the HTML shell (no `index.html` in the SSR path).
- The stream-transform pipeline (buffered flushing, `useServerInsertedHTML`
  injection, timeout cancellation) and `waitForAllReady` for bots.
- `@apollo/client-react-streaming`'s manual data transport riding Cedar's
  server-injection channel — this is exactly how the library intends custom
  frameworks to integrate.
- The route manifest (`buildRouteManifest.ts`) and server-side `matchPath` route
  matching.

---

## Decisions Already Made

### No Express

The rewritten SSR handler is a pure Web-standard Fetchable — the same contract
Universal Deploy already established for the API side
(`packages/api/src/runtime.ts`):

```ts
export default {
  fetch(request: Request): Promise<Response>
}
```

The `Response` body is the `ReadableStream` from `renderToReadableStream`,
passed through the existing transforms — no Node-stream conversion, no adapter.
Hosting is someone else's job, and there are three hosts, all fed by the same
Fetchable:

1. **srvx** in `cedar serve` (already a dependency, already hosting the UD API
   Fetchable) — the default for local and baremetal/VPS self-hosting, per UD's
   `@universal-deploy/node` direction.
2. **Provider server functions** (Netlify, Vercel, …) via the UD store and
   provider Vite plugins.
3. **Fastify**, as the compatibility lane for baremetal deploys with custom
   server setups (`api/src/server.ts`, `configureFastify`) — a thin Fastify
   plugin bridges `FastifyRequest` → `Request` → Fetchable → `Response` → reply,
   the same fetch-native adapter pattern the api-server's GraphQL plugin already
   uses (`packages/api-server/src/plugins/graphql.ts`). See 2.3.

`express`, `http-proxy-middleware`, and the `@whatwg-node/server` adapter leave
the streaming path entirely.

### Universal Deploy is the deployment story, not a parallel track

Streaming SSR stops being mutually exclusive with `--ud` and instead becomes a
UD **entry**: the SSR render Fetchable registers with the
`@universal-deploy/store` as the lowest-precedence catch-all (`/**`), behind the
API function routes. Provider plugins (`@netlify/vite-plugin`,
vite-plugin-vercel) then deploy SSR the same way they deploy the API — no
Cedar-maintained per-provider SSR adapters. The rewrite targets the unified
`buildCedarApp` pipeline exclusively; the legacy standalone streaming
build/serve path is deleted, not ported.

### Vite environments, not a standalone `viteBuild` call

`buildForStreamingServer.ts`'s hand-rolled SSR build is replaced by a render
environment declared in `buildCedarApp` alongside `client` and `api` — the same
foundation as the prerender plan's `prerender` environment. One config, all
Cedar plugins applied consistently, client manifest available to the render
environment's build.

### RSC code is not preserved

Per the RSC removal/rewrite decision: the rewritten streaming files contain
**zero** `rscEnabled` branches. The `importModule()` machinery, the second RSC
Vite dev server, `/rw-rsc` mounting, and RSC bootstrap shims are simply absent
from the new code. (Deleting the old RSC sources is the RSC removal effort's
job; this plan just guarantees the new streaming path has no RSC dependencies
for that effort to untangle.)

### The data layer stays on `@apollo/client-react-streaming`

Verified: the installed `@apollo/client-react-streaming` 0.14.5 supports Apollo
Client 4 (`peerDependencies: "@apollo/client": "^4.0.0"`) and requires React 19
— so the AC4 upgrade unblocked this rewrite the same way it unblocked
`prerenderStatic` for prerender. The transport mechanism
(`WrapApolloProvider(buildManualDataTransport)` over `useServerInsertedHTML`) is
kept; the provider itself is rebased onto `CedarApolloProvider` (Track 4).

---

## Prerequisites

| Prerequisite                                                        | Status                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Vite 7 Environment API                                              | ✅ Done (7.3.5)                                                                                |
| Apollo Client 4 upgrade                                             | ✅ Done (4.2.7)                                                                                |
| Universal Deploy foundation (`buildCedarApp`, UD store, srvx serve) | ✅ Done                                                                                        |
| React 18 support removal                                            | 🔜 Planned (streaming already de facto requires React 19 via `@apollo/client-react-streaming`) |
| RSC removal                                                         | 🔜 Planned (this plan must not block on it, but coordinates with it)                           |

---

## Track 1 — The render Fetchable and its build

### 1.1 Handler

A new `createStreamingHandler` (rewrite of `createReactStreamingHandler.ts` +
`streamHelpers.ts`, minus all RSC branches) producing
`(request: Request) => Promise<Response>`:

- Route matching against the route manifest with `matchPath` (unchanged), plus a
  real **404**: no manifest match → render the `NotFoundPage` route through the
  same pipeline (falling back to a plain 404 `Response`), replacing today's
  `throw`. This matching layer is the seed of the **server-side Cedar Router**:
  under the RSC plan it grows a per-route renderer discriminant in the manifest
  and dispatches each route to its renderer — so keep it a distinct,
  renderer-agnostic step rather than folding it into the streaming renderer.
- Middleware/auth: the existing Fetch-based middleware router and
  `ServerAuthProvider` seeding carry over; the per-request store
  (`createPerRequestMap` + `AsyncLocalStorage`) wraps the handler directly
  instead of being an Express middleware — `convertExpressHeaders` dies, the
  store is built from `request.headers` natively.
- Render: `renderToReadableStream` (`react-dom/server.edge`), `Document.tsx`
  shell, `bootstrapModules` from the client manifest, CSS links from the client
  manifest — all as today.
- Transforms: buffered flush → server-injection (Apollo chunks, head tags) →
  timeout cancel, unchanged in substance; `waitForAllReady` for bots via `isbot`
  stays.
- Timeout: configurable (`web.ssrRenderTimeoutMs` or similar in TOML),
  defaulting to the current 10s, instead of hardcoded.

### 1.2 The `ssr` render environment

In `buildCedarApp` (`packages/vite/src/buildApp.ts`), when streaming SSR is
enabled, declare a render environment:

- Input: a server entry that composes `entry.server.tsx` (the user's
  `ServerEntry`/`Document`) with `createStreamingHandler` and exports the
  Fetchable as `default { fetch }` — analogous to how the UD plugin's virtual
  modules wrap API functions.
- Output: `web/dist/ssr/server.mjs` (self-contained module graph; node_modules
  externalized, same externalization posture as the UD `ssr` build).
- Built **after** `client` (needs the client manifest for `bootstrapModules`/CSS
  links) — the `buildApp` hook in `buildCedarApp` already sequences environments
  explicitly.
- `buildRouteManifest` runs as part of this environment's build (or a
  `closeBundle` step), not as a separate CLI-orchestrated step.

**Naming collision:** `buildCedarApp`'s existing UD environment is named `ssr`
but holds the _API_ Fetchable. Rename it (`server`? `api-entry`?) and let the
render environment own `ssr` — but first verify what environment names the
provider plugins key on (open question 1).

### 1.3 Deletions (with Track 2)

- `packages/vite/src/runFeServer.ts`, `devFeServer.ts` (Track 3),
  `buildFeServer.ts`, `streaming/buildForStreamingServer.ts`
- `express`, `http-proxy-middleware`, `@whatwg-node/server` (from the streaming
  path), `convertExpressHeaders`
- The streaming branch of `packages/cli/src/commands/build/buildHandler.ts`
  (`cedar-vite-build.mjs` execa invocation) — streaming builds go through the
  same unified `buildCedarApp({ ud: true })` task as everything else
- The `cedar-dev-fe` / `cedar-serve-fe` bins from `packages/vite/package.json`

---

## Track 2 — Serving: srvx locally, Universal Deploy in production

### 2.1 `cedar serve` (local/self-host)

`packages/cli/src/commands/serve.ts` already builds the exact middleware chain
needed, for the UD SPA case: srvx web server → `serveStatic` over `web/dist` →
fetch-forwarding API proxy → SPA fallback (`200.html`). The SSR change is one
substitution: when streaming SSR is enabled, the final fallback imports
`web/dist/ssr/server.mjs` and delegates to its `fetch` instead of serving
`200.html`. Everything else — static assets, API proxy (or in-process API
Fetchable), port handling, graceful shutdown — is shared with the existing UD
serve path.

The API proxy deserves a note, since it is what retires `http-proxy-middleware`.
The proxy exists because the browser talks only to the web server and sends API
requests to the same-origin `web.apiUrl` path; the web server forwards them to
the api-server process (no CORS, one public port when self-hosting). The old
Express server needed a dependency for this; in the Fetch-native chain it is the
~20-line middleware already in `serve.ts` — strip the `apiUrl` prefix, re-issue
with `fetch()` (`duplex: 'half'`), return the streamed `Response` as-is. Two
situations skip the proxy entirely: provider deploys (the provider's routing
sends API paths straight to the function) and, later, fully unified
single-process serving, where forwarding can become a direct in-process call to
the API Fetchable's `fetch(request)` — same contract, no HTTP hop. That
optimization is enabled by the design but nothing in this plan depends on it.

`serveWebHandler.ts` / `serveBothHandler.ts`'s "skip Fastify, spawn
`cedar-serve-fe`" branches are deleted. The Fastify `@cedarjs/web-server`
remains what it is today — the non-streaming static server — untouched by this
plan (see "not covered").

### 2.2 Universal Deploy targets

Register the SSR Fetchable in the UD store from the Cedar UD Vite plugin,
alongside the API routes `discoverCedarRoutes()` already registers:

- Route pattern `/**` at lowest precedence (API routes and static assets win).
- `entry` pointing at the render environment's output.
- Provider plugins then either fold it into the single catch-all server function
  (`catchAllEntry`) or split it into its own function — whichever the provider
  plugin does for entries today. Default expectation: one combined server
  function handling both API and SSR HTML (simplest, and matches
  `@netlify/vite-plugin`'s single `server` function with `path: "/*"`); a split
  SSR function is an optimization to explore later (open question 2).
- Static assets are the provider CDN's job (`publish = web/dist` already); the
  SSR function only sees requests that miss the CDN.

Then remove the gates: `buildHandler.ts:360-363`'s `ud && !streamingSsr.enabled`
condition, `devHandler.ts`'s streaming bail-out (Track 3), and `serve.ts`'s
ordering that shunts streaming to the legacy path.

### 2.3 Fastify hosting (baremetal / custom-server compatibility)

Baremetal deploys (`cedar deploy baremetal` → pm2 → `cedar serve` on the box)
must keep working, including for apps with custom Fastify setups — UD's own plan
keeps a Fastify compatibility lane for exactly this audience rather than
silently dropping `api/src/server.ts` / `configureFastify` support. The SSR
rewrite follows the same rule:

- Provide a small Fastify plugin (natural home: `@cedarjs/web-server` or
  `@cedarjs/fastify-web`) that mounts the SSR Fetchable: build a `Request` from
  the Fastify request, call `fetch(request)`, and stream the `Response` back
  through the reply (`Readable.fromWeb(response.body)` — must flush
  progressively, not buffer; open question 3 covers verifying this).
- This is the same bridge pattern as the api-server's transitional fetch-native
  GraphQL adapter — one shared `fastifyRequestToWebRequest` /
  `webResponseToFastifyReply` helper pair should serve both rather than each
  package growing its own.
- The Fetchable itself stays host-agnostic: no Fastify (or srvx) types anywhere
  in `packages/vite`'s streaming code. Only the mounting plugin knows about
  Fastify.
- Default remains srvx; the Fastify lane is for projects that opt into (or
  already depend on) a custom Fastify server.

### 2.4 Semantics to preserve

- `waitForAllReady` bot handling must survive the UD hop (verify `isbot` and
  full-buffer rendering behave inside provider functions).
- Streaming must actually stream end-to-end: srvx and each provider runtime must
  flush the `ReadableStream` body progressively, not buffer it. Write an e2e
  that asserts time-to-first-byte < time-to-last-byte with a delayed cell (open
  question 3). The UD GraphQL wrapper's native-`Response` re-wrapping and
  `ERR_STREAM_PREMATURE_CLOSE` handling are prior art here.

---

## Track 3 — Dev server unification

Today `cedar dev` with streaming spawns `devFeServer` (Express + Vite middleware
mode + an RSC-only second Vite server), and the unified `--ud` dev server
refuses to run when streaming is on. Instead:

- The unified dev server gains an SSR middleware: for HTML-route requests, run
  `createStreamingHandler` with modules loaded through the dev server's `ssr`
  environment module runner (`createServerModuleRunner`) — per-request module
  loading keeps HMR semantics, exactly as `devFeServer` does today, minus
  Express and minus the RSC server.
- Dev CSS collection (`collectCss.ts` walking the module graph) carries over
  as-is; it is the one genuinely dev-only piece of the render pipeline.
- `devFeServer.ts` is deleted; `cedar dev` no longer forks on
  `streamingSsrEnabled`.

This also resolves the `--ud` flag overload: `dev --ud`'s unified server becomes
the only dev server able to do streaming, which is one more reason the unified
path stops being opt-out for streaming projects.

---

## Track 4 — Apollo provider convergence

- Rebase `packages/web/src/apollo/suspense.tsx` onto `CedarApolloProvider`
  (added during the AC4 upgrade): share link construction, cache config
  handling, and defaults with the non-streaming provider so the two cannot
  drift; the streaming provider adds only the
  `WrapApolloProvider(buildManualDataTransport(...))` wrapper and the absolute
  SSR GraphQL endpoint (`RWJS_EXP_SSR_GRAPHQL_ENDPOINT`).
- Keep the import-swap plugin (`vite-plugin-swap-apollo-provider.ts`) as the
  selection mechanism, updated for `CedarApolloProvider` imports.
- Under UD, the SSR GraphQL endpoint can short-circuit: the render function and
  the GraphQL function live in the same process/function, so an in-process
  terminating link (the same `inProcessGqlLink` concept as the prerender plan's
  2.1) can replace the HTTP round-trip. Profile first; HTTP-to-self also works
  on day one.
- Fix the stale comment chain around `RWJS_EXP_SSR_GRAPHQL_ENDPOINT`
  (`suspense.tsx` references `streaming/registerGlobals.ts`, which no longer
  exists; the global is set in `registerFwGlobalsAndShims.ts`).

---

## Open Questions

1. **Environment naming and provider-plugin expectations.** `buildCedarApp`'s UD
   API environment is currently named `ssr`. Before introducing a real render
   environment, determine which environment names `@netlify/vite-plugin` /
   vite-plugin-vercel / `@universal-deploy/vite` key on, and whether renaming
   breaks them. If `ssr` is contractual for "the server function bundle", the
   render environment takes another name (`web-ssr`?) and its output is fed into
   the `ssr` environment's catch-all. Extra weight from the RSC direction: the
   planned RSC rewrite foundation (`@vitejs/plugin-rsc`) defaults to
   environments named `client`/`ssr`/`rsc` (configurable via its `environment`
   option, but defaults are what its docs and examples assume) — one more reason
   the UD API bundle should vacate the `ssr` name sooner rather than later.
2. **One combined server function vs split SSR function.** Combined is simpler
   and matches the current Netlify `path: "/*"` server function; split keeps API
   cold-starts free of React/web code. Ship combined, measure bundle size and
   cold-start, revisit.
3. **Does streaming survive each hop?** srvx, Netlify functions, Vercel
   functions, and the Fastify bridge (`Readable.fromWeb` through a Fastify
   reply): verify progressive flushing of `ReadableStream` response bodies (no
   buffering) with an early e2e — this is the load-bearing assumption of the
   whole plan.
4. **Prerender + SSR coexistence.** Routes marked `prerender` are served
   statically from the CDN; unprerendered routes hit the SSR function. The route
   manifest knows which is which — but confirm the UD store can express
   "everything except these static paths", or accept that the CDN shadowing
   static files handles it implicitly.
5. **`react-dom/server.edge` vs `react-dom/server`.** The edge build's
   `renderToReadableStream` runs fine on Node ≥18 (Web Streams are native), but
   check whether React 19's Node entry now exposes it directly and whether
   provider runtimes prefer one build over the other.
6. **`entry.server.tsx` / `Document.tsx` template updates.** The setup command
   (`setupStreamingSsrHandler.ts`) and templates predate all of this; they need
   a pass (and the experimental setup command may graduate alongside UD setup
   rather than staying its own command).
7. **Non-UD streaming serve.** This plan makes the UD/unified pipeline the only
   streaming _build_ path. Confirm no supported deployment story needs streaming
   without it before deleting the legacy branch — self-host is covered twice
   over (`cedar serve` via srvx, custom servers via the Fastify bridge), since
   both host the same built Fetchable.

---

## Relationship to the Prerender and RSC Rewrites

- **Shared:** the `buildCedarApp` environment foundation, the client-manifest
  handoff, and the client-side cache-restore story. Both stage B plans delete a
  hand-rolled bundling pipeline in favor of environments.
- **Different render/data layer by design:** prerender (SSG) uses
  `prerenderStatic` with a per-route client at build time; SSR uses
  `renderToReadableStream` + `@apollo/client-react-streaming`'s transport at
  request time; RSC routes later use flight→HTML through the same Fetchable
  slot, selected per route by the dispatcher.
- **Shell convergence is a requirement, not a nice-to-have:** prerender
  currently renders into the `index.html` shell; SSR and RSC SSR render through
  `Document.tsx`. The migration gradient requires that crossing a stage boundary
  not change an app's shell, so prerender adopts `Document.tsx` once this plan
  establishes it in the serving path (see the prerender plan's
  strategic-positioning note).
- **Route hooks and the `/db/` move:** the `meta` hook introduced by this plan
  runs server-side per request and, like `routeParameters()` in the prerender
  plan, needs db access — today only via the `$api/src/lib/db` alias
  (`packages/vite/src/plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.ts`).
  See the prerender plan's "Relationship to SSR and RSC" section for why this
  is the concrete, near-term motivation for landing the first wave of the
  [RSC plan's `/db/` move](./2026-07-20-rsc-rewrite.md#the-db-move) ahead of
  RSC v1 itself, rather than waiting for it.

---

## Files Affected

**New/rewritten:**

- `packages/vite/src/streaming/createStreamingHandler.ts` (rewrite; Fetch
  handler, no RSC)
- `packages/vite/src/streaming/streamHelpers.ts` (rewrite in place; no RSC, no
  `importModule`)
- `packages/vite/src/buildApp.ts` — render environment + manifest step; UD-env
  rename per open question 1
- `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts` — SSR
  catch-all entry registration
- `packages/cli/src/commands/serve.ts` — SSR fallback branch in the srvx chain
- Fastify SSR mounting plugin (new, in `@cedarjs/web-server` or
  `@cedarjs/fastify-web`) + shared Fastify↔Fetch bridge helpers with
  `packages/api-server`
- Unified dev server — SSR middleware via `ssr`-environment module runner
- `packages/web/src/apollo/suspense.tsx` — rebase onto `CedarApolloProvider`

**Deleted:**

- `packages/vite/src/runFeServer.ts`, `packages/vite/src/devFeServer.ts`
- `packages/vite/src/buildFeServer.ts`,
  `packages/vite/src/streaming/buildForStreamingServer.ts`
- `cedar-dev-fe` / `cedar-serve-fe` bins; streaming branches in
  `serveWebHandler.ts` / `serveBothHandler.ts` / `buildHandler.ts` /
  `devHandler.ts`
- `express`, `http-proxy-middleware` from `packages/vite/package.json`;
  `@whatwg-node/server` if nothing else uses it
- `packages/vite/src/utils.ts` `convertExpressHeaders`

**Unchanged on purpose:**

- Stream transforms (`transforms/`), `collectCss.ts`, `buildRouteManifest.ts`
  (relocated invocation only), `isbot` handling, `ServerInject.tsx`, middleware
  router

---

## What This Does NOT Cover

- The RSC removal and rewrite
  ([2026-07-20-rsc-rewrite.md](./2026-07-20-rsc-rewrite.md); this plan only
  guarantees the new streaming code has no old-RSC dependencies and that its
  route-matching layer stays renderer-agnostic for the dispatcher)
- The prerender rewrite (companion plan; shared foundation noted above)
- Rewriting the non-streaming Fastify `@cedarjs/web-server` or the Fastify
  api-server — beyond the SSR mounting plugin (2.3), they are untouched; the
  srvx serve path is the obvious long-term direction for both, with Fastify
  persisting as the custom-server compatibility lane
- Graduating `streamingSsr` out of `experimental` — a release decision that
  should follow, not precede, this rewrite landing
