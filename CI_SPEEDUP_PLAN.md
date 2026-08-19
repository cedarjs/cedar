# CI Speedup Plan

## The diagnosis: CI isn't slow — the queue is

In a recent successful run (`gh run view 29683036814`), the **longest job took
13 minutes, but the run took 37 minutes** wall clock. The gap is entirely runner
queueing: jobs waited 6–32 minutes for a runner. The telemetry checks (3–5 min
of work) didn't start until minute 31–32.

The math explains it: one push to a PR spawns ~26 jobs from `ci.yml` plus the
fixture checks, CodeQL, changelog check, etc. — 30+ jobs. GitHub's free plan
caps concurrency at **20 concurrent jobs account-wide**, so a single PR
overflows the pool, and two active PRs (which the run history shows is common)
means everything stacks up behind everything else. Rerunning for flakes makes it
worse because reruns join the same queue.

## Suggestions, highest impact first

### 1. Remove the serial `needs: check` gate (~10 min saved)

Everything waits on `detect-changes` → `check`, and each stage boundary costs a
full queue round-trip — heavy jobs couldn't even _enqueue_ until minute ~4 and
didn't start until minute 12–16. `check` takes under a minute and almost never
catches what the smoke tests would miss.

Note: this is about `check`'s position in the graph, NOT about removing
`detect-changes`. The path filtering (skipping CI on docs-only changes, gating
RSC/SSR suites) stays exactly as it is. The graph goes from three serial stages
(`detect-changes` → `check` → heavy jobs) to two (`detect-changes` → everything
else).

- Every job that today has `needs: check` switches to `needs: detect-changes`
  with `if: needs.detect-changes.outputs.code == 'true'`. Docs-only PRs still
  skip everything — the skip just moves from "check was skipped, so its
  dependents skip" to each job checking the `code` output directly.
- `check` becomes a sibling of the heavy jobs (also gated on `detect-changes`).
  It still runs on every code change and still blocks merge via
  `ci-status-check` — it just stops being a mid-graph bottleneck.
- RSC/SSR gating is untouched; those jobs already read
  `needs.detect-changes.outputs.rsc/ssr` directly.

Trade-off: `check` currently fail-fasts the whole suite when constraints or
`package.json` sorting are broken. With the flat graph, a PR that fails `check`
also burns runner minutes on doomed heavy jobs. `check` fails rarely, so this is
a good trade. Middle ground if wanted: keep `needs: check` on just the Windows
matrix and let Ubuntu jobs start immediately.

### 2. Move the Windows matrix off the PR critical path (halves job count)

**Status: applied 2026-07-19**, as a content-based filter rather than a blanket
removal:

- `detect-changes` gained a `windows` output
  (`.github/actions/detect-changes/cases/windows.mts`): the Windows legs run
  when the PR's added lines use a path- or process-sensitive API (separators,
  drive letters/file URLs, spawn quoting, file locking — the historical
  Windows-breakage classes), or the PR touches `packages/cli` or
  `packages/vite`. Calibration: all 12 historical Windows-fix PRs would have
  triggered; ~35% of the last 100 merged PRs would have skipped Windows (~8 jobs
  each, and Windows is also the dominant flake surface).
- The eight Windows-matrix jobs in `ci.yml` use a dynamic matrix keyed on that
  output; the Windows-only `telemetry-check` job is gated on it.
- Escape hatch: add the `windows` label to a PR —
  `rerun-ci-on-windows-label.yml` automatically re-runs the latest CI run so
  detect-changes (which reads labels from the API at run time) picks it up.
  This is a separate workflow rather than `labeled` trigger types on ci.yml
  because those fire for every label (including the automated release
  labels) and would cancel-and-restart CI on each one.
- Pushes to `next` and `release/**` always run Windows.
- Safety net: `.github/workflows/nightly-windows.yml` runs the full Windows
  matrix against `main` daily (03:17 UTC) and opens/updates a tracking issue on
  failure.
- Bonus coverage: the test projects for smoke tests are now always created in a
  directory **with a space in the name** (`test project`, `test project esm`,
  `test project live`) — on all platforms, every run. Missing shell quoting now
  fails on the Ubuntu legs of every PR, a bug class CI never exercised before
  (runner paths had no spaces).

### 3. Consolidate micro-jobs

**Status: applied 2026-07-19.** Two consolidations:

- `server-tests`, the Ubuntu leg of `telemetry-check`, and `tutorial-e2e` are
  now one job (`.github/workflows/consolidated-tests.yml`). The Windows
  telemetry check keeps its own job.
- `formatting-check` is folded into the `check` job (two ~1-minute jobs with
  identical setup). The merged job is not gated on the `code` output so
  formatting still covers docs-only changes.

Net: three fewer jobs / queue slots per PR push.

#### Why nothing else is consolidated

Consolidation only pays off when a job's runtime is dominated by the ~3–4 minute
setup cost, AND merging doesn't break one of three constraints:

1. Don't bundle flaky suites — GitHub reruns at job granularity, so bundling
   makes every rerun more expensive and compounds failure probability.
2. Don't push any job past the ~13-minute critical path (the slowest Windows
   smoke jobs) — past that point consolidation trades queue slots for wall-clock
   time, a net loss.
3. Don't merge jobs with incompatible runner state.

Every remaining job against those rules:

| Job                          | Why it stays separate                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ud-tests` (5 min)           | 63% flaky (signature D). Isolation keeps its frequent reruns at 5 min.                                                                                                                                                                                                                                                                          |
| `e2e-node` (3 min)           | 45% flaky (signature D). Merging the two flaky jobs with each other would roughly double how often the combined job reruns.                                                                                                                                                                                                                     |
| `live-smoke-tests` (3 min)   | Stable, but heavy bespoke setup (live test project + tarsync + Playwright); adding it to `consolidated-tests` would push that job past the critical path. Also the best canary — keep its rerun signal clean.                                                                                                                                   |
| `create-cedar-app` (6 min)   | Switches the runner to Node 20 and 25 for its prompt tests. Solvable (run it last, or restore Node 24 with an `if: always()` step), but its ~4–6 min of post-setup work would push `consolidated-tests` (already ~11–13 min) past the ceiling. Pairing it with `live-smoke-tests` instead (~10–12 min) is possible but low-value once #2 lands. |
| `e2e-netlify` / `e2e-vercel` | Mergeable in principle (both 0% flaky) but use different secrets, databases, and cleanup workflows — a riskier refactor for one slot. Possible follow-up.                                                                                                                                                                                       |
| Smoke suites (4–8 min each)  | Not micro-jobs — setup is a minority of their runtime. Merging the Ubuntu smoke suites would create a ~20-minute job, extending the critical path. Parallelism is correct here.                                                                                                                                                                 |
| All Windows jobs             | 74–100% flaky-when-failing; consolidation would make Windows reruns worse. The fix for Windows is #2 (off the PR path), not consolidation.                                                                                                                                                                                                      |
| `detect-changes`             | The gate must stay minimal; anything added to it delays every other job.                                                                                                                                                                                                                                                                        |

With the three slots claimed, further consolidation has diminishing returns:
after #2 (Windows off the PR path) a push spawns ~17 jobs, at or under the
20-slot concurrency limit, so queueing mostly disappears anyway.

Rerun granularity trade-off: GitHub reruns at job granularity, so if one suite
in a consolidated job fails, the rerun repeats all of its suites. This costs
less than it sounds — the expensive parts of a rerun (queue wait + setup/build)
are paid once either way; the marginal cost is only the extra test-minutes of
the sibling suites. The real risk is compounding flakiness: a job bundling N
suites fails if _any_ of them flakes, and its rerun can flake on a different
suite. So:

- Only consolidate suites that are stable.
- Keep any known-flaky suite in its own job so its reruns stay cheap and
  isolated.
- Pair consolidation with test-level retries so reruns become rare in the first
  place.

### 4. Check Nx Cloud cache hit rates, especially on Windows

Every job rebuilds the framework via `yarn build`. Nx Cloud is wired up, so
Ubuntu jobs likely hit cache, but it's worth confirming Windows gets hits too
(path separators and line endings can poison hash inputs). If Windows is
cache-missing, that's a large chunk of its 12-minute runtime.

### 5. Add `concurrency` + `cancel-in-progress` to the other PR workflows

`ci.yml` has it, but if `check-test-project-fixture(-esm)`, `codeql-analysis`,
etc. don't, superseded runs keep eating queue slots after a new push.

### 6. Cut the package-manager smoke tests' install cost (~75s per npm job)

**Status: implemented 2026-07-21, not yet landed** (held for a follow-up PR to
the jest preset resolution fix, #2155).

Two independent wins, neither of which needs a cache:

- **Stop installing twice.** `setUpTestProject` used to run tarsync against a
  project that still looked like yarn's, so tarsync did a `yarn install`, and
  then npm/pnpm installed again on top. Converting the project to the target
  package manager _before_ tarsync means tarsync detects it and does the one
  install we want. Saves a whole yarn install (~14s) per npm/pnpm job. It also
  fixes a correctness problem: yarn's hoisted `node_modules` survived underneath
  the second install and masked bugs that only appear in a nested layout.
- **`npm install --no-audit --no-fund`.** npm runs a security audit and a
  funding lookup after every install — network round trips over the whole
  ~1800-package tree that tell us nothing about the framework build under test.

Measured on the same project, warm `~/.npm`, lockfile deleted between runs:

| install                                             | time    |
| --------------------------------------------------- | ------- |
| `npm install`                                       | **78s** |
| `npm install --no-audit --no-fund --prefer-offline` | **17s** |
| `npm install --no-audit --no-fund`                  | **18s** |

`--prefer-offline` contributes nothing; the entire 60s is the audit. Install
times through the new path, one install per job: yarn 13.6s, pnpm 18.2s, npm
26.8s.

#### On caching the npm cache directory

Considered and **not** adopted, on the grounds that it's now attacking the
_remaining_ ~18–27s rather than the 60s the audit flag already removed.

You can pass a path to npm for it to use for storing its cache: `--cache <dir>`.
By pointing at a **stable** path (like `<os.tmpdir()>/cedar-e2e/npm-cache`) you
isolate it from the global `~/.npm` across concurrent installs, and so it can
keep a cache warm across _many_ projects within a single run. Our smoke test
does exactly one install per job, so there's no second install in the same run
right now to benefit.

The only version that would help us is persisting a cache across runs with
`actions/cache`, since GitHub-hosted runners start with an empty `~/.npm`. The
value of the `--cache` flag for us would be giving that cache a stable,
predictable path to key on. Worth benchmarking before adopting: saving and
restoring a cacache for ~1800 packages is itself tens of seconds of
upload/download, plausibly a wash against an 18s install.

Two things to know before anyone tries it:

- **Stale tarballs are not a risk** (checked 2026-07-21). npm's cache key for a
  local tarball is the relative path — `pacote:tarball:file:tarballs/cedarjs-web.tgz`
  — with integrity only as metadata, and every run rebuilds tarballs under
  identical names at the same version. But npm re-reads the file rather than
  trusting the cache entry: repacking a tarball with a sentinel file, same name
  and version, then reinstalling, installs the new contents.
- **Caching `node_modules` or the lockfile would break**, because tarsync writes
  **absolute** tarball paths into the project's overrides. A tree or lockfile
  cached from one runner path carries paths that don't exist on the next. (This
  is why projects deliberately uses relative `file:` specifiers.) Fix that
  first if lockfile/tree caching is ever wanted — the npm cache directory itself
  is unaffected.

## On flakiness specifically

The definitive source here is
[`docs/implementation-plans/flaky-smoke-tests-investigation.md`](docs/implementation-plans/flaky-smoke-tests-investigation.md),
which log-classified 621 failed jobs across the last 100 merged PRs. Key numbers
from it:

- **28% of failed jobs were flaky** (172/621), and **42% of merged branches hit
  at least one flaky failure** — that's the rerun pain quantified.
- **Windows accounts for 67% of all flakiness.** `Smoke tests (windows)` was
  flaky in 96% of its failures, `Background jobs E2E (windows)` in 100%. This is
  a second, independent argument for moving the Windows matrix off the PR
  critical path (suggestion #2): it removes both half the job count AND
  two-thirds of the flake surface in one change.
- **Signature A — the V8 Maglev JIT crash (nodejs/node#62260) — alone is 52% of
  all flakiness.** A mitigation shipped 2026-07-18: `cedar dev` grew a
  `--node-args` flag and the dev-type Windows smoke suites now pass
  `--node-args="--no-maglev"`. Not yet wired: the `serve`-type bins
  (`cedar-serve-fe`, `@cedarjs/web-server`), the api-server watch bins, and
  storybook — finishing those is the highest-ROI flakiness work remaining.
- **Signature D — Ubuntu esbuild "service is no longer running" (19% of
  flakiness, mostly Universal Deploy tests and E2E-node)** — is NOT a Maglev
  issue and needs the separate `afterEach` hook hardening / hook-timeout
  increase described in the investigation doc's 2026-06-26 entry.
- Jobs with **0% flaky failures** (every failure real): Build/lint/test
  (ubuntu), prettier, Tutorial E2E, RSC Smoke (ubuntu), E2E Vercel/Netlify, CLI
  smoke (ubuntu), Server tests, Create Cedar App. These are the safe candidates
  for micro-job consolidation (suggestion #3).

Practical notes:

- **Rerun only failed jobs**, not the whole run:
  `gh run rerun <run-id> --failed` (or the "Re-run failed jobs" button). This is
  dramatically cheaper on the queue than a full rerun.
- **Live Smoke tests is NOT flaky** (checked 2026-07-19): it failed in 7 of the
  last 8 failing runs, but all 7 were legitimate catches — 6 from
  `lisa/esm-extension-rewriting` (API server crashed at startup on a missing
  `.js` ESM extension for the `skipAuth` directive import) and 1 from
  `upgrade-apollo-client-4` (9 `liveQuery.spec.ts` tests failing consistently
  across Playwright retries). It's a good canary; don't quarantine it. It also
  doesn't appear in the investigation doc's flakiest-jobs table, which is
  consistent.
- The Netlify and Vercel deploy e2e jobs, despite depending on external
  services, have a clean record: **0 flaky failures out of 14 fails each** in
  the 100-PR sample. No need to move them off the PR path for flakiness reasons
  — only queue-slot pressure would justify that.

## TL;DR

If only two things get done, do #1 and #2 — together they should take a typical
run from ~37 minutes to roughly the length of the longest Ubuntu job plus one
queue wait, i.e. **~10–15 minutes**, without buying anything. The paid
alternative (GitHub Team bumps concurrency to 60) also works but masks the
structural cost rather than removing it.
