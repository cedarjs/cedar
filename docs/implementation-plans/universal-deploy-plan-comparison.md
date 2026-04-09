# Comparison: Original vs. Refined Universal Deploy Plan

## Overview

This document contrasts the original "Plan: Cedar + Universal Deploy Integration" with a refined version of the same plan. Both plans share the same core architecture, guiding principles, and seven-phase structure. The refined plan preserves the original's technical direction while adding specificity around scheduling, migration, developer experience, and areas the original left as open questions. The goal of this comparison is to help contributors and decision-makers quickly understand what changed and why.

## Summary Table

| Dimension            | Original                                                                                         | Refined                                                                                                                                    | Why It Matters                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Context Shape**    | `CedarRequestContext` includes `headers`, `url`, `cookies`, `params`, `query`, `serverAuthState` | Removes `headers` and `url` (already on `Request`); keeps only Cedar-specific enrichments: `cookies`, `params`, `query`, `serverAuthState` | Avoids redundant data on the context object. Leaner context means fewer places where framework state can diverge from the actual request. |
| **Middleware**       | No explicit middleware model                                                                     | Adds composable `(Request, CedarRequestContext) -> Response` pipeline                                                                      | Gives Cedar a clear story for auth guards, logging, CORS, and other cross-cutting concerns without ad-hoc wiring.                         |
| **Phase Ordering**   | 7 strictly sequential phases                                                                     | Same 7 phases with explicit parallelization: Phases 2+3 can run concurrently after Phase 1; SSR design work can begin during Phases 4/5    | Reduces wall-clock time for the overall effort without changing dependency relationships.                                                 |
| **Migration**        | Not addressed; minimizing breaking changes listed as a non-goal                                  | Adds migration/compatibility section: shims for existing Lambda handlers, codemods, clarity on which phases are internal vs. user-facing   | Acknowledges that existing Cedar apps need a path forward even if the end state is significantly different.                               |
| **Effort Estimates** | None provided                                                                                    | T-shirt sizes per phase — Phase 1: L, Phase 2: M, Phase 3: M, Phase 4: XL, Phase 5: L, Phase 6: XL, Phase 7: M                             | Enables rough capacity planning and helps teams understand relative investment across phases.                                             |
| **GraphQL**          | Mentioned but underspecified                                                                     | Calls out Yoga's existing `fetch()` signature as a quick win in Phase 1                                                                    | GraphQL is Cedar's most-used server entry. Clarifying that Yoga is already Fetch-aligned de-risks Phase 1 significantly.                  |
| **Transitional DX**  | Not discussed                                                                                    | Adds notes: two-port model persists until Phase 4; Phases 1–3 are mostly invisible to app developers                                       | Sets expectations so developers are not surprised by intermediate states during the multi-phase rollout.                                  |
| **Entry Model**      | Open question deferred to end: one dispatcher entry vs. per-route entries                        | Promoted to Phase 2 with a recommendation: start with a single dispatcher, option to split later                                           | Resolving this early prevents downstream phases from building on an ambiguous foundation.                                                 |
| **Adapter Pattern**  | Mentioned but not detailed                                                                       | Adds explicit section explaining what adapters do and names target runtimes: Node, Vercel, Netlify, Cloudflare                             | Makes the adapter boundary concrete so that Phase 3 and Phase 7 work can proceed with a shared understanding of scope.                    |

## Detailed Differences

### CedarRequestContext Is Leaner

The original context included `headers` and `url` alongside Cedar-specific fields. The refined plan removes both because they are already available on the standard `Request` object passed as the first argument. Duplicating them on the context creates ambiguity about which copy is authoritative and increases the surface area for bugs where the two fall out of sync.

### Explicit Middleware Pipeline

The original plan described handler execution but did not address how cross-cutting concerns like authentication, logging, or header manipulation would compose. The refined plan introduces a middleware model based on the same `(Request, CedarRequestContext) -> Response` signature used by handlers. This means middleware and handlers share one mental model, and middleware can be stacked without framework-specific lifecycle hooks.

### Phase Parallelization

The original plan presented all seven phases as a strict sequence. The refined plan identifies that Phase 2 (Route Discovery) and Phase 3 (Node Adapter) have no dependency on each other — both only require Phase 1's Fetch-native handler contract. Running them in parallel shortens the overall timeline. Similarly, design work for the SSR rebuild (Phase 6) can begin during the Vite-centric dev and UD registration phases without blocking implementation.

### Migration and Compatibility Strategy

The original plan explicitly listed "minimizing breaking changes" as a non-goal. The refined plan keeps the same end-state ambition but acknowledges that a migration path is still necessary for adoption. It adds shims so existing Lambda-shaped handlers continue to work during the transition, proposes codemods to automate common transformations, and clarifies which phases affect app developers directly versus which are internal framework changes.

### T-Shirt Effort Estimates

The original plan provided no sizing information. The refined plan assigns T-shirt estimates to each phase: two XL phases (Vite-centric dev and SSR rebuild), two L phases (Fetch-native handlers and UD registration), and three M phases (route discovery, Node adapter, and provider validation). These estimates make it possible to plan staffing and identify the two largest risks — Phase 4 and Phase 6 — early.

### Stronger GraphQL Story

The original plan noted that "GraphQL is closer to Fetch internally because Yoga already exposes `fetch()` semantics" but did not draw out the implication. The refined plan explicitly calls out Yoga's existing Fetch-compatible interface as a quick win for Phase 1: Cedar's GraphQL entry can be wrapped as a Fetch-native handler with minimal effort, giving the team an early proof point for the new contract.

### Transitional Developer Experience

The original plan did not discuss what the developer experience looks like between phases. The refined plan adds specific notes: the two-port development model (web on 8910, api on 8911) persists until Phase 4 completes, and Phases 1 through 3 are largely invisible to application developers because they change internal framework plumbing rather than user-facing APIs. This transparency helps prevent confusion during the rollout.

### Dispatcher Question Resolved Earlier

The original plan left the choice between a single dispatcher entry and per-route entries as an open question at the end of the document. The refined plan promotes this decision to Phase 2 and recommends starting with a single dispatcher entry. This is the simpler model, avoids premature optimization for provider-specific routing, and leaves the door open to split entries later once real provider constraints are better understood.

### Adapter Pattern Made Concrete

The original plan mentioned adapters in passing but did not describe what an adapter is responsible for. The refined plan adds an explicit section: an adapter translates Cedar's `handler(request, ctx?) -> Response` contract into the entry shape required by a specific runtime or provider. It names four target adapters — Node, Vercel, Netlify, and Cloudflare — and scopes what each one must handle (request translation, response mapping, static asset integration, and platform-specific lifecycle concerns like `waitUntil`).

## What Stayed the Same

The refined plan preserves all of the original plan's foundational decisions:

- **Core contract**: Cedar's primary server contract remains `handler(request, ctx?) -> Response` using standard Web API `Request` and `Response` types.
- **Guiding principles**: Cedar owns its runtime contract, Fetch is the center of gravity, Cedar context stays Cedar-specific, and SSR comes after runtime modernization.
- **Phase goals**: Every phase has the same objective in both plans. The seven phases address the same problems in the same conceptual order.
- **Non-goals**: Neither plan attempts to preserve Lambda as the primary contract or carry the experimental Express-based SSR runtime forward.
- **Risk awareness**: Both plans identify the same core risks — premature UD integration, lingering Lambda assumptions, SSR complexity inheritance, and context abstraction leakage.

The refined plan is an evolution, not a replacement. It adds operational detail and resolves ambiguity without changing the architectural direction.

## Recommendation

The refined plan should serve as the working document going forward. It preserves every architectural decision from the original while adding the scheduling, migration, and specificity needed to execute across multiple contributors and phases. Teams should reference the refined plan for phase sequencing, effort estimation, and the resolved design questions (context shape, dispatcher model, adapter scope) that the original left open. The original plan remains valuable as a record of the initial architectural reasoning and can be consulted for the full rationale behind the guiding principles.
