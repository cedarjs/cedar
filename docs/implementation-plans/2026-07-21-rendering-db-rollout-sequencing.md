# Rendering + `/db/` Rollout Sequencing

**Date:** 2026-07-21 **Author:** Tobbe (with Claude) **Status:** Reference

Cross-cutting reference for the order of attack across four companion plans.
This doc doesn't duplicate their content — it only tracks sequencing and
dependencies between them. See each plan for the actual design:

- [unified-prisma-db-module-plan.md](./unified-prisma-db-module-plan.md) —
  configurable `dbModule`/`prismaConfig` resolution (`[db]` table)
- [2026-07-18-prerender-rewrite.md](./2026-07-18-prerender-rewrite.md) —
  Vite-environment-based static prerendering
- [2026-07-20-streaming-ssr-rewrite.md](./2026-07-20-streaming-ssr-rewrite.md) —
  request-time streaming SSR
- [2026-07-20-rsc-rewrite.md](./2026-07-20-rsc-rewrite.md) —
  `@vitejs/plugin-rsc`, Server Cells, server-side Cedar Router, and the `/db/`
  move

---

## Phase 0 — start now, in parallel

No blocking dependencies between these; all can proceed concurrently.

- **Unified Prisma db-module plan.** Self-contained and purely additive (no
  existing behavior changes), so nothing blocks it — and it's the one thing
  everything downstream that touches db location depends on. Start here first.
- **Old RSC implementation removal.** Independent cleanup; explicitly
  parallelizable per the RSC plan.
- **React 18 support removal.** Blocks prerender Track 2 and is already de facto
  assumed by streaming SSR's Apollo transport — unlocks two things at once.
- **Prerender Track 1** (Vite `prerender` environment replacing the Rollup
  bundler). No unmet prerequisites per that plan.
- **Streaming-SSR Tracks 1–3** (render Fetchable + build, serving, dev-server
  unification). Vite 7 / Apollo 4 / UD foundation are already done; proceeds
  alongside prerender Track 1 as companion Stage B work.

## Phase 1 — once React 18 removal lands

- Prerender Track 2 (`prerenderStatic` data layer)
- Streaming-SSR Track 4 (Apollo provider convergence)

## Phase 2 — once the unified plan has landed and Stage B is far enough along

- **`/db/` move Wave 1** — workspace identity, singleton move, migration
  codemod, `[db]` TOML, retiring the route-hook `$api/` resolvers
  (`buildRouteHooks.ts`, `vite-plugin-cedarjs-resolve-cedar-style-imports.ts`).
  Gated on the unified plan's resolver existing and on route hooks
  (`routeParameters()`, the `meta` hook) being prominent enough that removing
  the `$api/` workaround is worth doing.
- **Flip `create-cedar-app` templates to `/db/` by default** (all four:
  `js`/`ts`/`esm-js`/`esm-ts`, together — no ESM/CJS or JS/TS split), tied
  directly to Wave 1 completing, not to anything RSC-specific.

## Phase 3 — once Stage B's serving/build foundation is solid + UD `ssr` rename

- **RSC v1** — plugin-rsc integration, entries, per-route dispatcher, Server
  Cells (GraphQL-backed `data()` works here already), server functions,
  auth/middleware, shell.
- **`/db/` move Wave 2** (`server-only` enforcement) lands alongside — it has
  nothing to enforce against until RSC v1 introduces client components. This is
  what unlocks direct-DB Server Cells specifically.

## Phase 4

- RSC v2 — Router Cells, RSC SSG.

## Phase 5 (v3+)

- Router Cell SSR, then the Stage D default flip (server-side Cedar Router
  becomes the default) once parity is real.

---

## Key sequencing decisions baked into this order

- The unified plan is additive-only by design (`api.prismaConfig` keeps working
  via fallback indefinitely), which is exactly why nothing needs to wait for it
  except the `/db/` move — it never introduces a breaking window to plan around.
- `/db/`'s two waves are deliberately split: Wave 1's payoff (route hooks
  dropping the `$api/` alias) doesn't need RSC at all, so it lands at the Stage
  B boundary; Wave 2 (`server-only` enforcement) is meaningless before RSC v1
  introduces the client-component boundary it protects.
- New-app template defaults flip on Wave 1 alone — new apps have zero migration
  cost, so the only real gate is "does this deliver a visible benefit yet," not
  "has RSC shipped."
- The old RSC implementation's behavior and limitations (e.g. its TS-only setup
  gate) are not evidence for anything in this sequencing — it's being deleted,
  not inherited from.
