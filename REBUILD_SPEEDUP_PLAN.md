# Plan: Cut `rebuild-test-project-fixture` Execution Time in Half (With Output Parity + Command Realism)

**Current total: ~179s → Target: ~90s (need to save ~89s)**

This revised plan explicitly prioritizes:

- **Output parity**: no changes to final fixture contents or structure (including keeping two separate migrations if that is part of current output).
- **Command realism**: preserve the script’s role as an integration/e2e exercise of real Cedar user workflows (`yarn cedar ...`, `yarn install`, etc.).
- **Measurable wins over noise**: runtime variance is currently ~±5s, so we only accept changes that clearly beat measurement noise.

---

## Hard Constraints (Non-Negotiable)

- [x] Do **not** change fixture output shape/content as a speed optimization.
- [x] Do **not** replace user-facing Cedar CLI workflows with synthetic shortcuts.
- [x] Keep two migration steps if current output expects two migrations.
- [x] Prefer optimizations that improve orchestration, concurrency, and process overhead while preserving command semantics.
- [x] Every claimed win must be validated with repeatable benchmarking.

---

## Baseline Timing Context

| Step | Description                    | Duration   | Notes                                      |
| ---- | ------------------------------ | ---------- | ------------------------------------------ |
| 0    | Build Cedar framework          | 6.41s      | `yarn clean && yarn build`                 |
| 1    | Create project                 | 26.61s     | `create-cedar-app`                         |
| 2    | Add framework deps             | 1.01s      |                                            |
| 3    | Install node_modules + tarsync | 23.09s     | `yarn install` + `project:tarsync`         |
| 4    | Update ports                   | 0.00s      | sync file write                            |
| 5    | Copy framework packages        | 2.78s      |                                            |
| 6    | Add postinstall                | 0.00s      | sync file write                            |
| 7    | **Web codemods**               | **46.99s** | pages, layout, components, cells, tailwind |
| 8    | **API codemods**               | **39.61s** | prisma, scaffolds, dbAuth                  |
| 9    | Workspace packages             | 17.68s     | generate, install, build                   |
| 10   | Scripts                        | 3.60s      | generate + verify                          |
| 11   | Prisma migrate reset           | 2.57s      |                                            |
| 12   | Lint fix                       | 3.94s      |                                            |
| 13   | Replace + cleanup              | 4.54s      |                                            |

Hotspots remain step 7 + 8 + 1 + 3 + 9.

---

## Measurement Plan First (Before More Refactors)

Because run-to-run variance is ~5s, we need a stricter benchmark method.

### Benchmark Protocol

- [ ] Run **7 iterations** per variant (baseline and candidate).
- [ ] Use alternating order to reduce drift bias: `A B A B A B A`.
- [ ] Capture:
  - overall duration
  - per-step durations (especially 7, 8, 9)
  - median + p90 (not only average)
- [ ] Keep environment stable:
  - same Node/Yarn version
  - same machine state as much as possible
  - no extra heavy background jobs
- [ ] Define acceptance gate:
  - overall median improvement should be **>= 8s**, or
  - clear repeated step-level improvement where the changed step drops materially beyond noise.

### Why this is required

- [ ] Prevent false positives/negatives from noise.
- [ ] Avoid churn on micro-optimizations that don’t move real wall-clock time.

---

## What We Will Not Do (Given New Constraints)

- [x] **No migration batching** that changes output from two migrations to one.
- [x] **No replacing Cedar CLI generator/setup commands** with direct file writes solely for speed.
- [x] **No “fake” integration path** that departs from what users actually run.

---

## Revised Optimization Backlog (Constraint-Safe)

## Phase 1 — Safe, Behavior-Preserving Wins (near-term)

- [x] Parallelize dbAuth package `build:pack` calls in step 8.6 (already done).
- [ ] Keep two migration commands (8.0 and 8.3) unchanged, but optimize around them.
- [ ] Merge near-zero-cost copy-only subtasks (8.7, 8.9, 8.10) to reduce orchestration overhead.
- [ ] Start measuring each candidate using the benchmark protocol above before keeping it.

**Estimated cumulative impact**: small-to-moderate (~5–12s including already-landed win).

---

## Phase 2 — Concurrency Without Output Drift

Goal: parallelize only independent work that does not alter final output or reduce command coverage.

### Candidate A: Overlap non-conflicting web work

- [ ] Evaluate running `updateCellMocks` and related non-route codemods while Tailwind setup runs.
- [ ] Verify no conflicts on shared files (`Routes.tsx`, lockfiles, config files touched by setup).
- [ ] Keep all same commands, only adjust scheduling.

### Candidate B: Conservative parallelism in web generation paths

- [ ] Test whether component/cell generation can run concurrently **without** changing output.
- [ ] Add strict file-diff parity check between baseline and parallel version.
- [ ] Keep generators as real Cedar commands; only alter orchestration.

**Estimated impact**: moderate (~8–20s if safe parallelism holds).

---

## Phase 3 — Reorder Step 7/8 Execution with Dependency Guardrails

This is still the largest potential win, but must preserve output and command realism.

### Principles

- [ ] Treat `Routes.tsx`-touching operations as a serialized lane.
- [ ] Allow parallelism only for tasks that do not touch shared route/config surfaces.
- [ ] Preserve the exact same command set and side effects.

### Proposed workstream split

- [ ] **Serialized lane**: page/scaffold/auth/prerender route-mutating tasks.
- [ ] **Parallel lane**: independent API/web tasks not touching route graph.
- [ ] Introduce explicit dependency barriers between lanes.

### Safety checks required

- [ ] Golden output snapshot comparison (full fixture tree diff).
- [ ] Step-by-step command transcript parity (same commands still exercised).
- [ ] Multiple benchmark runs to prove stable gain beyond noise.

**Estimated impact**: high (~20–35s), but medium/high implementation risk.

---

## Phase 4 — Process Overhead Reduction Without Changing Commands

The rebuild script still launches many subprocesses. We can reduce overhead while preserving what’s exercised.

### Codemod execution path

- [ ] Investigate lowering per-codemod spawn overhead while keeping codemod behavior identical.
- [ ] Keep codemods and target files the same; optimize invocation strategy.
- [ ] Validate exact output parity with fixture diffing.

### Install/build sequencing

- [ ] Review whether repeated installs/build-related work can be sequenced more efficiently **without removing command coverage**.
- [ ] Any consolidation must still test the intended user-relevant commands.

**Estimated impact**: moderate (~10–20s depending on what is feasible without realism loss).

---

## Output Parity & Realism Validation Checklist (Required for Every Optimization)

For each proposed change:

- [ ] **Fixture parity check**: byte-for-byte (or normalized) diff of generated fixture tree.
- [ ] **Migration parity check**: migration folder count and names remain expected.
- [ ] **Command coverage check**: expected Cedar/user commands still run.
- [ ] **Benchmark check**: pass acceptance gate (>=8s median improvement or strong step-level win).
- [ ] **Rollback path**: easy revert if either parity or reliability fails.

---

## Revised Prioritized Sequence

1. [ ] Lock in benchmark harness and acceptance criteria.
2. [ ] Land only low-risk orchestration cleanups with parity checks.
3. [ ] Attempt conservative concurrency in step 7 sub-operations.
4. [ ] Attempt guarded 7/8 lane split with strict route-serialization rules.
5. [ ] Optimize codemod/process overhead while preserving command realism.
6. [ ] Re-evaluate total and decide if additional high-risk work is necessary.

---

## Practical Success Criteria

We consider the project successful when all are true:

- [ ] Median runtime is close to or below ~90s.
- [ ] Output fixture remains equivalent to current expected output.
- [ ] Script still functions as an integration/e2e run of realistic Cedar commands.
- [ ] Performance gains are reproducible across repeated runs (not noise artifacts).

---

## Notes

- The prior migration-batching idea is now explicitly rejected under current constraints.
- The plan now favors **orchestration and measurement discipline** over output-shaping shortcuts.
- If future constraints loosen (e.g., migration-output flexibility), we can reopen those larger structural optimizations.
