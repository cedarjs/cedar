# RSC Rewrite: `@vitejs/plugin-rsc`, Server Cells, and a Server-Side Cedar Router

**Date:** 2026-07-20 **Author:** Tobbe (with Claude) **Status:** Proposal

Companion to
[2026-07-18-prerender-rewrite.md](./2026-07-18-prerender-rewrite.md) and
[2026-07-20-streaming-ssr-rewrite.md](./2026-07-20-streaming-ssr-rewrite.md).
The current RSC implementation is being removed entirely (see the streaming-SSR
plan's background for how deeply it is entangled with the old streaming code);
this plan defines what replaces it, from scratch.

---

## Strategic Frame: One Gradient, Not Two Stacks

Cedar is a niche framework with a small number of well-paying users. What they
pay for is a **stable framework that gradually brings them up to modern web and
React standards**: they like the SPA feeling, and they want modern tooling and
capabilities under it. At least one production customer (e-commerce) uses
prerendering and needs it faster and better integrated, plus first-class SSR.

The rendering roadmap is therefore **one continuous migration gradient**, not a
legacy mode and a successor mode:

- **Stage A (today):** client-side Cedar Router, client-rendered pages, Apollo
  cells.
- **Stage B (prerender + streaming-SSR rewrite plans):** the same app served
  modern — Fetch-native web server, fast concurrent prerendering
  (`prerenderStatic`), first-class streaming SSR with the Apollo transport.
  First-class work for today's apps, not legacy maintenance.
- **Stage C (this plan, v1–v2):** RSC arrives **per-route and per-cell**. A page
  becomes a server component; a cell's `QUERY` becomes a `data()` export and it
  is a Server Cell; Router Cells put server-rendered islands inside client
  pages.
- **Stage D (this plan, v3+):** the balance has shifted — Cedar Router runs
  server-side as the authoritative router, the client keeps a thin shell doing
  link interception and flight fetching, and Apollo remains first-class for the
  interactive islands that want it.

**The keystone that makes the gradient real is a per-route dispatcher**: the web
Fetchable's internal router consults the route manifest and sends each route to
the renderer it belongs to — SPA shell, Apollo streaming SSR, or RSC
flight→HTML. A single app can sit _between_ stages (prerendered Apollo product
pages and RSC marketing pages in one deploy). That dispatcher **is** the
server-side Cedar Router, arriving incrementally rather than as a mode switch.

Cedar stays **GraphQL-forward**: the api workspace remains a GraphQL API, and
Server Cells' `data()` may query it (or any external service) — or use the
database directly via the shared `/db/` package (see below). Some teams will run
web-only with direct DB access; others will keep web as a
backend-for-the-frontend delegating to the api workspace. Both are supported
shapes, not competing philosophies.

---

## Foundation Choice: `@vitejs/plugin-rsc`

Two candidates were evaluated in depth (repos cloned and read, not just
README'd):

**`@vitejs/plugin-rsc`** — the Vite team's framework-agnostic RSC foundation,
born from the 2025 collaboration between the React, React Router, Waku, and Vite
teams. Verified as of 2026-07-20: v0.5.28, ~992k weekly downloads, actively
maintained; Waku migrated its bundler layer to it, React Router's RSC framework
mode and TanStack Start build on it. Architecture: three Vite environments
(default names `rsc`/`ssr`/`client`, configurable), an RSC entry whose default
export is an async `(request: Request) => Response` handler,
`import.meta.viteRsc` helpers for cross-environment loading and CSS collection,
build-time `"use server"`/`server-only`/`client-only` enforcement, encrypted
server-function closures, and server-component HMR (`rsc:update`).

**`vite-plugin-react-server`** (nicobrinkkemper) — a genuinely well-built
solo-maintained plugin (~2.9k weekly downloads). Contrary to its README-level
reputation it _does_ use the Vite Environment API and ships a thoughtful
Web-runtime edge request handler with per-request dynamic rendering. Its model
is page/route-centric (`Page`, `build.pages`, routes baked into bundles) with an
optional file-based router.

**Decision: `@vitejs/plugin-rsc`.** The reasons, in order:

1. **Primitives, not a framework-in-a-plugin.** Cedar keeps its own router and
   cell model; it needs an RSC _library_ under its own architecture.
   plugin-rsc's explicit design goal is exactly that — the framework writes the
   request handler. vite-plugin-react-server would have Cedar translating its
   cell/island model into someone else's page model.
2. **The contract is Cedar's contract.** plugin-rsc's RSC entry is a
   Web-standard Fetchable — a UD-registrable handler with zero adaptation,
   identical to the API and SSR handler contracts in the companion plans.
3. **The Router Cell idea already exists as a plugin-rsc example.** The `no-ssr`
   example does `createFromFetch(fetch(url))`, holds the flight payload in React
   state, re-fetches on navigation, and wires `setServerCallback` for server
   functions — the Router Cell is that pattern scoped to a cell subtree.
4. **Shared churn beats solo stability.** plugin-rsc is 0.x and will have
   breaking changes — absorbed alongside Waku/React Router/TanStack. The
   alternative's realistic failure mode is vendoring an entire RSC bundler (~20
   subsystems) and tracking React's flight protocol alone.
5. The marketing story ("Cedar builds on Vite's official RSC foundation") comes
   for free.

`vite-plugin-react-server` remains worth mining for ideas — its edge request
handler (flight-vs-HTML content negotiation, baked-route manifests) is prior art
for Cedar's dispatcher, and Cedar is open to contributing if edge support ever
needs it.

---

## Decisions Already Made

- **One web render Fetchable per app.** The RSC entry is the outer
  `Request → Response` handler registered as the UD catch-all entry (the slot
  the streaming-SSR plan reserves). It content-negotiates: flight requests
  (`text/x-component` accept header / URL convention) get the flight stream;
  document requests get HTML by delegating to the `ssr` environment in-process.
  No separate RSC function, no placement decision — Router Cells (v2) are just
  another negotiated route inside the same handler.
- **SSR (flight→HTML) is a v1 requirement**, not a later phase. The v3+ deferral
  applies only to SSR _of Router Cell islands_.
- **Per-route opt-in via the dispatcher** from day one. RSC is never an app-wide
  mode switch.
- **Server Cells keep the cell contract.** `Loading`/`Empty`/`Failure`/
  `Success` stay; `QUERY` is replaced by an exported `data()` function.
  Migration of a cell is changing one export.
- **The database layer moves to a top-level `/db/` workspace** so `data()` can
  use it without a `fetch()` hop to the api workspace (details below).
- **Node-only initially.** Edge is on the roadmap but years out; plugin-rsc is
  runtime-agnostic so nothing here closes that door.
- **Old RSC code contributes nothing.** No `rscEnabled` branches, no
  `importModule` machinery, no second dev server, no `globalThis.__REDWOOD__*`
  RSC globals. Deleting the old code is the separate RSC-removal effort; this
  plan guarantees the new code has no dependencies on it.

---

## Prerequisites

| Prerequisite                                             | Status                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Apollo Client 4 / React 19                               | ✅ Done                                                                     |
| Universal Deploy foundation (`buildCedarApp`, UD store)  | ✅ Done                                                                     |
| Serving/build foundation (streaming-SSR plan Tracks 1–3) | 🔜 Required first — shared substrate                                        |
| Old RSC implementation removal                           | 🔜 Separate effort, can proceed in parallel                                 |
| `/db/` move                                              | 🔜 Needed for direct-DB Server Cells; `data()` via GraphQL works without it |
| UD `ssr` environment rename (streaming-SSR plan OQ 1)    | 🔜 plugin-rsc defaults to claiming `ssr`                                    |

Sequencing across the three plans: (1) serving/build foundation, (2) stage B
rewrites (prerender + streaming SSR, both tracks — they serve paying customers
now and everything carries forward), (3) RSC v1, (4) RSC SSG + Router Cells, (5)
stage D default when parity is real.

---

## The Ladder

### v1 — RSC routes, with SSR, behind the dispatcher

- **Environments:** adopt plugin-rsc's `rsc`/`ssr`/`client` environments inside
  `buildCedarApp`, composed with the existing `client`/`api`/UD environments.
  plugin-rsc's `client` maps onto Cedar's existing client environment; the UD
  API environment must vacate the `ssr` name first.
- **Entries:** Cedar owns all three plugin-rsc entries as framework code
  (virtual modules, like the UD plugin's function wrappers) — users do not write
  `entry.rsc.tsx` by hand. The RSC entry embeds the dispatcher; the SSR entry
  renders flight into the `Document.tsx` shell; the browser entry extends
  Cedar's client bootstrap with `createFromFetch` + payload state +
  `setServerCallback`.
- **Routing:** the route manifest gains a renderer discriminant (open question 2
  covers how a route declares itself RSC). The dispatcher sends RSC routes
  through flight→HTML and everything else to the stage B renderers. Route
  matching reuses `matchPath` and the manifest — the same machinery all
  renderers share.
- **Server Cells:** `createServerCell` with an exported `data()` in place of
  `QUERY`. `data()` runs only in the `rsc` environment; it may query the api
  workspace (GraphQL over fetch, or an in-process link when co-deployed), any
  external service, or the `/db/` package directly. Cell state mapping: pending
  promise → `Loading`, thrown error → `Failure`, empty-check → `Empty`, resolved
  → `Success` — same user-facing contract as classic cells.
- **Server functions:** `"use server"` supported from v1 (plugin-rsc handles
  encoding/decoding; Cedar wires the endpoint through the same Fetchable).
- **Auth/middleware:** the Fetch-based middleware router and server auth state
  from the streaming-SSR plan run _before_ the dispatcher, so all renderers
  share one auth/middleware story.
- **Shell:** `Document.tsx` is the HTML shell for RSC SSR — the same shell the
  streaming-SSR plan uses. This is a hard requirement of the gradient (crossing
  a stage boundary must not change an app's shell).

### v2 — Router Cells and RSC SSG

- **Router Cells:** a cell that is a mini RSC entry point inside an otherwise
  client-rendered page. The client cell issues a flight request to the web
  Fetchable (keyed by cell identity + serialized props/variables), renders its
  `Loading` state while the request is in motion, then renders the flight
  payload; server functions inside the island round-trip through
  `setServerCallback`. Client components inside the island hydrate via
  plugin-rsc's browser runtime.
- **RSC SSG:** the same flight→HTML pipeline invoked at build time (plugin-rsc's
  `ssg` example is the blueprint), emitting `.html` plus static `.rsc` payloads
  so client navigation onto prerendered routes stays flight-driven. Prerendering
  becomes per-route dual-engine: classic routes via `prerenderStatic`, RSC
  routes via SSG, one shared output layout — one user-facing prerender feature.

### v3+ — Router Cell SSR and the stage D default

- **Router Cell SSR:** islands rendered server-side into the streamed HTML
  during SSR/prerender (the three-environment handshake), so first paint is
  complete instead of showing island loading states.
- **Stage D:** when parity is real (auth, forms, cells, dev DX), new apps
  default to the server-side Cedar Router with the thin client shell; the
  dispatcher makes this a default flip, not a migration event.

---

## The `/db/` Move

The Prisma layer moves from `api/db/` to a **top-level `/db/` workspace**.
Deciding test: the folder is framework-managed (`cedar prisma` targets it,
migrations generate into it, seeds run from it), and framework-managed
directories live at the app root (`api`, `web`, `scripts`) — not in user-land
`packages/`. It also makes the api workspace genuinely optional for web-only
teams.

Verified starting point: Cedar (post-prismaV7 codemod) already generates the
Prisma client to a custom output (`api/db/generated/prisma`, imported via the
`api` workspace name — no `node_modules/.prisma`), and `cedar.toml`'s
`api.prismaConfig` points at a standard Prisma `defineConfig` file that owns
schema/migrations/seed paths. Pointing `prismaConfig` at
`./db/prisma.config.cjs` relocates the entire Prisma toolchain in one move.

What the config does not cover — the actual work:

- **Workspace identity:** `/db/package.json` (its own workspace) with the
  generated client inside it and `exports` for the client and the `db`
  singleton, so web can import it without dragging the api workspace's
  dependency tree. Package naming convention is an open detail (plain `db` works
  — workspace resolution shadows the registry — but a scoped convention may be
  safer for generators).
- **The singleton:** `api/src/lib/db.ts` moves to `/db/src/` with a lean
  dependency budget — a small `@cedarjs/db` helper package rather than dragging
  `@cedarjs/api` (logger wiring) into the db package; SQLite relative-URL
  resolution re-anchored from the api dir to the db dir.
- **Enforcement:** the db package imports `server-only`, making "a
  `"use client"` component imports `db`" a build error via plugin-rsc's
  validation. This is the compile-time boundary that makes direct-DB `data()`
  safe to offer.
- **Migration:** a codemod sibling of the existing prismaV7 suite
  (`updatePrismaConfig`, `updateTsConfigs`, `rewriteRemainingImports`, …), plus
  sweeping the scattered `api/db` assumptions (gitignore, tsconfigs, `dbSchema`
  consumers like dataMigrate, docs, CI examples — Cedar's own Netlify e2e does
  `rm -rf api/db/migrations`).
- **TOML:** a `[db]` section with `api.prismaConfig` kept as a back-compat
  alias.

---

## Cedar Router: the Server Half

- **Shared:** route definitions (`Routes.tsx`), the route manifest, and
  `matchPath` — already renderer-agnostic.
- **Server side:** the dispatcher in the web Fetchable is the server-side Cedar
  Router. v1: it discriminates renderers. Stage D: it is the authoritative
  router for RSC-routed apps (redirects, private routes, 404s resolved
  server-side).
- **Client side:** the thin shell — link interception, history integration,
  flight re-fetch on navigation (the `no-ssr` example's `listenNavigation`
  pattern, owned by Cedar Router). For SPA/stage B routes, today's client router
  keeps working unchanged; the shell and the classic router share
  link-interception machinery so mixed apps navigate seamlessly across the
  boundary.

---

## Open Questions

1. **Renderer discriminant.** How does a route declare itself RSC — a prop on
   `<Route>` in `Routes.tsx` (fits "everything in Routes.tsx" Cedar philosophy),
   a page-level export, or a file convention? Must be statically analyzable for
   the manifest and the build-time environment split.
2. **Apollo islands inside RSC routes.** Client components under a flight
   payload that use Apollo hooks need a client-side `ApolloClient` — presumably
   `CedarApolloProvider` living in the client shell above the payload. Define
   the supported level for v1 (probably: works, no SSR'd cache transport) and
   how it relates to Apollo's own RSC integration (`PreloadQuery` etc.) later.
3. **Server function key management.** plugin-rsc encrypts closures with a
   build-time key (`defineEncryptionKey`); multi-function/multi-region deploys
   and rebuilds need a stable-key story (env var, UD-provided).
4. **Web server bundle weight.** Direct-DB Server Cells put the Prisma client
   (and engine) into the web server function. Measure cold start and bundle size
   on Netlify/Vercel; this may motivate the split-function option from the
   streaming-SSR plan's open question 2.
5. **Router Cell payload semantics (v2).** Keying (cell id + serialized props),
   variable-change refetch policy, response caching (private routes must not
   cache), and payload versioning across deploys.
6. **plugin-rsc churn policy.** 0.x: pin exact versions, track releases
   deliberately (as Waku does), and keep Cedar's integration surface behind
   framework-owned entries so user apps never import plugin-rsc directly.
7. **Dev integration.** plugin-rsc's dev mode drives its environments through
   the Vite dev server — confirm it composes with the unified `--ud` dev server
   (which also hosts the api environment and, per the streaming-SSR plan, the
   SSR middleware) in one process.
8. **`data()` context.** What does `data()` receive — current user/auth state,
   request headers, params? Needs one context contract shared with server
   functions and middleware.

---

## Files Affected (high level — this lands in phases)

- `packages/vite` — plugin-rsc integration in `buildCedarApp` (environments,
  framework-owned virtual entries, dispatcher), UD store registration
- `packages/router` — server half (dispatcher, server-side redirects/404), thin
  client shell (link interception, flight fetch)
- `packages/web` — `createServerCell`, Router Cell runtime (v2), client
  bootstrap extensions
- New: `/db/` app-template workspace, `@cedarjs/db` helper, db-move codemod
- `packages/cli` — route/manifest tooling, `setup` commands, generators
  (`cedar g cell --server`?)

---

## What This Does NOT Cover

- Removing the old RSC implementation (separate effort, already decided)
- The stage B rewrites themselves (companion plans; this plan depends on their
  serving/build foundation)
- Api workspace / GraphQL server changes — the api side is untouched
- Edge runtime support (roadmap, years out; kept open, not designed here)
- Deep Apollo-RSC integration (`PreloadQuery`, streamed cache transport into
  islands) — future work on top of open question 2
