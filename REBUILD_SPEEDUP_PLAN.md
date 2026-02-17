# Plan: Cut `rebuild-test-project-fixture` Execution Time in Half

**Current total: ~179s → Target: ~90s (need to save ~89s)**

## Current Timing Breakdown

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

### Step 7 Sub-steps (Web Codemods — 46.99s)

| Sub-step | Description                                                | Duration |
| -------- | ---------------------------------------------------------- | -------- |
| 7.0      | Create pages (nested, 7 sub-tasks)                         | 17.83s   |
| 7.0.0    | Home page (`yarn cedar g page` + codemod)                  | 5.57s    |
| 7.0.1    | About page                                                 | 2.26s    |
| 7.0.2    | Contact page                                               | 2.20s    |
| 7.0.3    | Blog post page                                             | 2.74s    |
| 7.0.4    | Profile page                                               | 2.20s    |
| 7.0.5    | MDX story (file write only)                                | 0.00s    |
| 7.0.6    | Waterfall page                                             | 2.85s    |
| 7.1      | Create layout (`yarn cedar g layout` + codemod)            | 1.25s    |
| 7.2      | Create components (3× `yarn cedar g component` + codemods) | 4.84s    |
| 7.3      | Create cells (4× `yarn cedar g cell` + codemods)           | 10.87s   |
| 7.4      | Update cell mocks (4× `applyCodemod`)                      | 2.26s    |
| 7.5      | Routes codemod                                             | 0.59s    |
| 7.6      | Tailwind setup (`yarn cedar setup ui tailwindcss`)         | 9.36s    |

### Step 8 Sub-steps (API Codemods — 39.61s)

| Sub-step | Description                                       | Duration   |
| -------- | ------------------------------------------------- | ---------- |
| 8.0      | Add models + prisma migrate                       | 2.97s      |
| 8.1      | Scaffold post                                     | 8.16s      |
| 8.2      | Seed script (codemod)                             | 0.56s      |
| 8.3      | Contact model + scaffold                          | 4.07s      |
| 8.4      | Rename migration folders                          | 0.00s      |
| 8.5      | Users service (SDL + codemod + types)             | 6.17s      |
| 8.6      | **dbAuth** (build:pack ×3, install, setup, pages) | **15.53s** |
| 8.7      | describeScenario tests (file copies)              | 0.00s      |
| 8.8      | Prerender routes (page + Routes.tsx)              | 2.15s      |
| 8.9      | Context tests (file copies)                       | 0.00s      |
| 8.10     | Vitest tests (file copies)                        | 0.00s      |

---

## Key Observations

1. **~30 `yarn jscodeshift` subprocess calls** across the script. Each spawns a
   new Node process with ~0.5–1s overhead = 15–30s of pure process-spawning cost.
2. **~15 `yarn cedar g` generator calls** (page ×6, component ×3, cell ×4,
   layout ×1, scaffold ×2+). Each spawns Node, loads the framework, and writes
   boilerplate that we immediately overwrite with codemods anyway.
3. **Steps 7 and 8 are fully sequential** despite operating on mostly different
   parts of the project (web vs api). The conflict points are limited to
   `Routes.tsx` and type generation.
4. **Three `yarn install` calls** in total: step 3, step 8.6 (dbAuth), step 9.

---

## Phase 1: Quick Wins (Est. savings: ~15s)

Low-risk, small code changes.

- [x] **Parallelize `build:pack` in `addDbAuth` (step 8.6)** — Already done.
      Three independent `yarn build:pack` calls in separate directories.
      _Saves ~5–8s from the 15.53s dbAuth step._

- [ ] **Batch prisma migrations (steps 8.0 + 8.3)**
      Currently two separate `yarn cedar prisma migrate dev` calls: one for
      post+user models, one for contact model. Add all three models to
      `schema.prisma` first, then run a single migration.
      _Saves ~3s (eliminates one prisma client generation cycle)._

- [ ] **Run `updateCellMocks` concurrently with Tailwind setup (steps 7.4 + 7.6)**
      `updateCellMocks` (2.26s) applies 4 codemods to separate mock files.
      `routes` codemod (0.59s) modifies Routes.tsx. Neither conflicts with
      `yarn cedar setup ui tailwindcss` (9.36s) which modifies config files.
      Restructure `webTasks` so that after cells are created, Tailwind setup starts
      immediately while cell mocks and the routes codemod run alongside it.
      _Saves ~3s (the mocks + routes work completes within Tailwind's 9.36s window)._

- [ ] **Move pure file-copy tasks out of the sequential pipeline**
      Steps 8.7 (describeScenario), 8.9 (context tests), 8.10 (vitest tests) are
      all pure `fs.copyFileSync` calls taking ~0ms each but still incur the
      `tuiTask` overhead. Merge them into a single step.
      _Saves ~1s of task orchestration overhead._

---

## Phase 2: Parallelize Generators Within Steps (Est. savings: ~15–20s)

Medium-risk — requires verifying that Cedar generators don't conflict when
operating on separate directories.

- [ ] **Parallelize cell generation (step 7.3)**
      `createCells` runs 4 sequential `yarn cedar g cell` calls (blogPosts,
      blogPost, author, waterfallBlogPost). Each creates files in its own
      `web/src/components/<Name>Cell/` directory. They don't touch Routes.tsx or
      shared config. Run all 4 generators concurrently with `Promise.all`, then
      apply their codemods (also independent files) concurrently.
      _Saves ~7s (10.87s → ~4s — bounded by the slowest single generator)._

- [ ] **Parallelize component generation (step 7.2)**
      `createComponents` runs 3 sequential `yarn cedar g component` calls
      (blogPost, author, classWithClassField). Same pattern — independent
      directories, no shared files. Run concurrently.
      _Saves ~3s (4.84s → ~2s)._

- [ ] **Parallelize independent web generators (steps 7.1 + 7.2 + 7.3)**
      Once individual generator parallelism is proven safe, go further: run
      `createLayout`, `createComponents`, and `createCells` all concurrently since
      they create files in completely separate directories.
      _Saves additional ~5s on top of the per-step parallelism above (layout and
      components complete within cells' window)._

---

## Phase 3: Parallelize Across Steps 7 and 8 (Est. savings: ~25–30s)

Medium-to-high risk — requires restructuring the task pipeline. This is the
single biggest opportunity.

### Why it's not trivial

Steps 7 and 8 both touch `Routes.tsx`:

- Page generators (step 7.0) add route entries
- Scaffold generators (steps 8.1, 8.3) add route entries + web pages
- dbAuth (step 8.6) generates auth pages + routes
- Routes codemod (step 7.5) rewrites routes
- Prerender (step 8.8) adds prerender flags to routes

### Proposed restructuring

Split the current steps 7 and 8 into dependency-aware groups that maximize
concurrency:

- [ ] **Group A — Non-route generators (run in parallel)**
      All of these create files in isolated directories and don't touch Routes.tsx:
  - Web: `createLayout`, `createComponents`, `createCells`, `updateCellMocks`
  - API: Add all prisma models + run single batched migration (from Phase 1)
  - Web: Tailwind setup
    _Duration: ~11s (bounded by cells or Tailwind, whichever is longer)._
    _Current sequential cost of these same tasks: ~33s._

- [ ] **Group B — Route-touching generators (sequential, but after Group A)**
      These must run sequentially because they each append to Routes.tsx:
  - Page generators (home, about, contact, blogPost, profile, waterfall)
  - Scaffold post
  - Scaffold contacts
  - Users service (SDL + types, doesn't touch routes but depends on scaffolds)
    _Duration: ~26s (this is the unavoidable sequential core — see Phase 4 for
    how to attack it)._

- [ ] **Group C — Post-scaffold work (partially parallel)**
  - dbAuth setup (can run as soon as scaffolds are done)
  - Routes codemod (must run after all route-adding generators)
  - Prerender routes (must run after routes codemod)
  - describeScenario, context tests, vitest tests (file copies, run any time)
    _Duration: ~16s (bounded by dbAuth)._

**Net effect**: Current steps 7+8 take ~87s sequentially. With this grouping:
~11s + ~26s + ~16s = ~53s. **Saves ~34s.**

---

## Phase 4: Eliminate Subprocess Overhead (Est. savings: ~20–30s)

High effort, high reward. Attacks the root cause of why individual steps are
slow.

### 4a. Replace `applyCodemod` jscodeshift subprocesses with in-process transforms

- [ ] **Convert jscodeshift codemods to in-process AST transforms**
      Each `applyCodemod` call spawns `yarn jscodeshift` as a subprocess (~0.5–1s
      overhead per call). There are ~30 such calls throughout the script. Options:
  1. Use `jscodeshift`'s programmatic API (import and call `run()` directly)
     instead of spawning it as a CLI subprocess.
  2. For simpler codemods that just replace content, convert them to direct
     string replacements (several codemods in `addDbAuth` already do this
     inline).
     _Saves ~15–25s of cumulative process-spawn overhead._

### 4b. Replace generator subprocesses with direct file creation

- [ ] **Bypass `yarn cedar g page/component/cell/layout` for known outputs**
      Each generator call spawns a full Node process, loads the Cedar framework,
      resolves the project, generates boilerplate files, and (for pages) modifies
      Routes.tsx. We then immediately overwrite the generated files with codemods.
      Instead:
  1. Create the expected directory structure and files directly with
     `fs.mkdirSync` / `fs.writeFileSync`.
  2. Write the final (post-codemod) content directly, skipping both the
     generator AND the codemod.
  3. For pages: append route entries to Routes.tsx directly (or accumulate them
     and write once).
  4. Run a single `yarn cedar g types` at the end to regenerate type
     definitions.
     _Saves ~20–30s (eliminates ~15 generator subprocess spawns at ~2s each, plus
     their corresponding codemod subprocess spawns)._
     _Risk: Generator output format may change between versions. Mitigate by
     capturing expected output as template files and adding a test that verifies
     templates match generator output._

---

## Phase 5: Eliminate Redundant Work (Est. savings: ~10–15s)

- [ ] **Cache framework build (step 0, 6.41s)**
      Hash the source files under `packages/`. Skip `yarn clean && yarn build` if
      the hash matches the last build. Store the hash in a `.build-hash` file.
      _Saves ~6s when sources haven't changed (common during repeated test runs)._

- [ ] **Eliminate redundant `yarn install` calls**
      Currently three `yarn install` invocations:
  1. Step 3: initial install (23.09s — unavoidable)
  2. Step 8.6 (inside `addDbAuth`): installs dbAuth tarball resolutions
  3. Step 9: installs workspace package dependency

  Consolidate: set up dbAuth resolutions and workspace package.json entries
  BEFORE step 3's install, so a single `yarn install` handles everything.
  _Saves ~5–8s (eliminates at least one full `yarn install` cycle)._

- [ ] **Skip `yarn cedar build` in step 9 if only validating structure**
      Step 9 runs `yarn cedar build` to verify the workspace package builds
      correctly. If the validation could be done with a lighter check (e.g. just
      `tsc --noEmit`), it could be faster.
      _Saves ~3–5s._

---

## Summary: Estimated Savings by Phase

| Phase | Description                                            | Est. Savings | Cumulative |
| ----- | ------------------------------------------------------ | ------------ | ---------- |
| 1     | Quick wins (batch migrations, parallel mocks+tailwind) | ~15s         | ~15s       |
| 2     | Parallel generators within steps                       | ~15–20s      | ~30–35s    |
| 3     | Parallel across steps 7 & 8                            | ~25–30s      | ~55–65s    |
| 4     | Eliminate subprocess overhead                          | ~20–30s      | ~75–95s    |
| 5     | Eliminate redundant work                               | ~10–15s      | ~85–110s   |

> **Phases 1–3 alone should be sufficient to hit the ~90s target.** Phase 4 and
> 5 provide additional headroom and are worth pursuing if the parallelization
> gains are smaller than estimated (e.g. due to I/O contention or generator
> conflicts).

## Recommended Execution Order

1. Start with **Phase 1** — these are safe, isolated changes that can be shipped
   immediately and verified by running the script once.
2. Move to **Phase 2** — test each generator type (cells, components) for
   concurrent safety with a trial run before committing.
3. Tackle **Phase 3** — this is the biggest refactor and the biggest payoff.
   Implement the group-based restructuring behind a `--parallel` flag initially
   so the sequential path remains as a fallback.
4. **Phase 4** is independent of the parallelization work and can be done in
   parallel by a different person. Start with the simplest codemods
   (string-replacement-only) and convert them first.
5. **Phase 5** is opportunistic — pick up items as convenient.
