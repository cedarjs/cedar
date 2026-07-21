# Investigation: Flaky Windows Smoke Tests (`ERR_CONNECTION_REFUSED`)

## Summary

Multiple smoke test suites (`serve`, `fragments-serve`, `prerender`) fail
intermittently on Windows CI runners with `net::ERR_CONNECTION_REFUSED` when
trying to reach `http://localhost:8910`. The failure is not deterministic —
sometimes the suite passes entirely, sometimes it fails partway through.

This document tracks the investigation and applied mitigations.

## Observed Failure Pattern

From run
[25702624909](https://github.com/cedarjs/cedar/actions/runs/25702624909/job/75468866374)
(PR #1754, Windows fragments smoke tests):

- 10 tests total, 3 passed, 7 failed across all retries
- The 3 passing tests use `noJsBrowser` to navigate to pre-rendered pages
- Every `page.goto()` call fails with `ERR_CONNECTION_REFUSED`
- `page.waitForResponse()` times out after 30 seconds
- All 3 retries per test produce the same error — the server does not recover

### Chronology from CI Logs

| Time (UTC) | Event                                                  |
| ---------- | ------------------------------------------------------ |
| 23:40:48   | First API server starts on port 8911                   |
| 23:41:05   | `yarn cedar build` prerendering begins                 |
| 23:41:09   | **Apollo GraphQL error** during prerender of `/double` |
| 23:41:18   | `yarn cedar serve` starts for tests (PID 6460)         |
| 23:41:19   | Web server reports listening on `127.0.0.1:8910`       |
| 23:42:08   | Server **restarts** — new process (PID 5924)           |
| 23:42:09   | Web server listening again                             |
| 23:44:32   | All remaining tests fail with `ERR_CONNECTION_REFUSED` |

### Apollo Error During Build

```
An error occurred! For more details, see the full error text at
https://go.apollo.dev/c/err#%7B%22version%22%3A%223.14.1%22%2C%22message%22%3A17%2C%22args%22%3A%5B%5D%7D
❯ Prerendering /double -> web/dist/double.html
✔ Prerendering /double -> web/dist/double.html
```

The error occurs during `yarn cedar build` (prerender phase) when fetching
GraphQL data for the `/double` page. Despite the error, the prerender step
completes and produces `web/dist/double.html`. The error code (`"message":17`)
is an Apollo Client internal error from version 3.14.1.

## Potential Root Causes

### 1. `localhost` DNS Resolution (Mitigated)

On Windows, `localhost` can resolve to `::1` (IPv6) instead of `127.0.0.1`
(IPv4). If the web server binds to IPv4 only, connections via `localhost` fail.
The Playwright configs used `localhost` in both `webServer.url` and
`use.baseURL`.

**Mitigation:** Changed all three configs to use `127.0.0.1` directly.

### 2. Insufficient Server Startup Timeout (Mitigated)

Playwright's `webServer` checks the URL to determine readiness, but the default
60-second timeout may be too tight on slower Windows CI runners where
`yarn cedar serve` needs to start both the API and web servers and bind to
their ports.

**Mitigation:** Increased `webServer.timeout` to 120 seconds on CI.

### 3. Server Crash During Test Execution (Unresolved)

The server restart at 23:42:08 (different PID) indicates the original process
died. Possible causes:

- A specific page (`/double` with the Apollo error) triggers an unhandled
  exception in the web server
- Memory pressure on the CI runner causes the OS to kill the process
- The prerender build step leaves port 8910 in a bad state

This needs further investigation — reproduce the crash locally with the same
build artifact and test page.

### 4. Apollo Error in Prerender Build (Needs Investigation)

The Apollo error during `/double` prerender may produce a broken HTML file that
the server then crashes trying to serve or that triggers a crash during client
rehydration. The smoke test for `/double`
(`Check that rehydration works for page not wrapped in Set`) uses
`expect(errors).toMatchObject([])` which silently ignores errors.

## Applied Mitigations

### Changed Files

- `tasks/smoke-tests/serve/playwright.config.ts`
- `tasks/smoke-tests/fragments-serve/playwright.config.ts`
- `tasks/smoke-tests/prerender/playwright.config.ts`

### Changes

1. `localhost` → `127.0.0.1` in both `baseURL` and `webServer.url`
2. Added `timeout: process.env.CI ? 120_000 : 60_000` to `webServer`

## Open Questions

- What is Apollo Client error code 17, and why does it occur during `/double`
  prerender?
- Does the broken `/double` prerendered HTML cause the server to crash at
  runtime?
- Why does the server restart once (PID change) but then die permanently?
- Can we add a health-check endpoint to `cedar serve` so Playwright can verify
  the server is truly ready before tests start?
- Should the `expect(errors).toMatchObject([])` pattern be replaced with an
  explicit `expect(errors).toEqual([])` to catch hidden errors?

## Next Steps

1. Monitor CI runs after the `127.0.0.1` and timeout mitigations are merged
2. If flakiness persists, investigate the Apollo error during `/double`
   prerender
3. Consider replacing `toMatchObject([])` with explicit error assertions in
   rehydration tests
4. If confirmed fixed, promote this document to `docs/implementation-docs/`

---

## Update 2026-05-12 — Scope expanded, timeout reverted

### Initial fix was incomplete

Following the initial mitigation in PR #1756, CI flagged failures in
`Smoke tests ESM` and `Smoke tests React 18` on both Ubuntu and Windows.
These suites weren't affected by the original 3-file fix because they also use
Playwright configs that hardcoded `localhost`.

The `localhost` → `127.0.0.1` change needed to be applied across **all** smoke
test configs (12 files total), not just the three serve-type configs:

| Config                                                                                          | Type                     | Port                   |
| ----------------------------------------------------------------------------------------------- | ------------------------ | ---------------------- |
| `serve`, `fragments-serve`, `prerender`, `rsa`, `rsc`, `rsc-kitchen-sink`, `streaming-ssr-prod` | `yarn cedar serve`       | 8910                   |
| `dev`, `fragments-dev`, `streaming-ssr-dev`                                                     | `yarn cedar dev`         | 8910 (web), 8911 (API) |
| `rsc-dev`                                                                                       | `yarn cedar dev`         | 8910                   |
| `live`                                                                                          | `yarn cedar dev` + setup | 8910 (web), 8911 (API) |
| `storybook`                                                                                     | `yarn cedar storybook`   | 7910                   |

### Test assertions also hardcoded `localhost`

Changing `baseURL` from `localhost` to `127.0.0.1` broke URL assertions in test
files that expected `http://localhost:8910/...`:

- `tasks/smoke-tests/shared/common.ts` — three `expect(page.url()).toBe(...)`
  assertions for `/about`, `/contact`, `/posts`
- `tasks/smoke-tests/dev/tests/authChecks.spec.ts` — login redirect URL check
- `tasks/smoke-tests/rsc-kitchen-sink/tests/rsc-kitchen-sink.spec.ts` — cookie
  domain set to `localhost:8910` → changed to `127.0.0.1`

### 120s timeout reverted

The `webServer.timeout` increase from 60s to 120s was removed from all configs.
`yarn cedar serve` only starts servers and binds ports — it does not compile or
generate anything. The default 60-second Playwright timeout for `webServer.url`
readiness is sufficient.

### Greptile review

Greptile flagged an issue in the initial PR:

1. This investigation doc originally described `yarn cedar serve` as
   "compiling, generating, starting both API and web servers" — corrected:
   `cedar serve` only serves pre-built assets from `api/dist/` and
   `web/dist/`.

### Current state

After the full set of changes across 12 config files and 3 test files, all CI
smoke test suites that use Playwright with a `webServer` now resolve to
`127.0.0.1` instead of `localhost`. The `localhost` → `::1` (IPv6) resolution
issue on Windows CI runners is eliminated for all suites.

Still open: the root cause of the server crash (PID change mid-run) and the
Apollo error during `/double` prerender remain uninvestigated.

---

## Update 2026-05-12 — CLI smoke test failure: "Generating dbAuth secret"

### Evidence

From run
[25732654425](https://github.com/cedarjs/cedar/actions/runs/25732654425/job/75561731517)
(PR #1757, CLI smoke tests on Windows):

```
Generating dbAuth secret
Error: The process 'C:\npm\prefix\yarn.cmd' failed with exit code 1
    at ChildProcess._handle.onexit (node:internal/child_process:306:5)
```

The `yarn.cmd` process fails during the `cedar build` step of the CLI smoke
test, specifically at the "Generating dbAuth secret" phase. This is a different
failure mode from the `ERR_CONNECTION_REFUSED` and Vite crashes — it's a build
infrastructure issue, not a runtime server crash.

### Prevalence

I (@tobbe) think I've seen this before. Needs tracking if it appears again to
determine if it's specific to Windows or certain dependency versions. If
flakiness continues, those are the next areas to focus on.

---

## Update 2026-05-12 — Vite native crash on React 18 + Windows

### Evidence: buffer overrun in `cedar-vite-dev`

From run
[25729552439](https://github.com/cedarjs/cedar/actions/runs/25729552439/job/75551189080)
(PR #1756, React 18 + Windows smoke tests), the Vite web server crashes hard
two seconds after startup:

```
[WebServer] web | 10:57:56 AM [vite] (client) ✨ new dependencies optimized
[WebServer] web | 10:57:56 AM [vite] (client) ✨ optimized dependencies changed. reloading
[WebServer] web | yarn cross-env NODE_ENV=development cedar-vite-dev --no-open
                 exited with code 3221226505
```

Exit code `3221226505` (`0xC0000409`) is Windows'
`STATUS_STACK_BUFFER_OVERRUN` — a native stack corruption, typically caused by
a native addon (esbuild, SWC, better-sqlite3, etc.) writing past a buffer
boundary. This is a hard crash, not a Node.js exception.

### Exit code 1 is not a crash

The same run (and another renovate run) also showed `exited with code 1` from
the Vite process, but these occur right after the last test passes — they're
Playwright tearing down the `webServer` child process after the dev test step
completes. Both the API server and Vite exit with code 1 simultaneously, which
is normal clean-up behavior.

### Prevalence check

The `STATUS_STACK_BUFFER_OVERRUN` crash was systematically searched for across:

- 7 recent failed PR runs: 0 occurrences
- 20 recent main branch runs: 0 occurrences
- All non-zero Vite exit codes in 40 runs: only clean teardowns (exit code 1)

However, the crash recurred shortly after in an unrelated PR —
`renovate/publint` (#1758, a trivial `publint` version bump). Same React 18 +
Windows smoke test, same exit code `3221226505`. This confirms the crash is
**not** a one-off — it's a recurring issue potentially related to the React 18
downgrade on Windows runners.

### Decision

This is a framework-level bug in the React 18 + Vite + Windows combination, not
a CI fluke. The next step is running the React 18 downgrade scenario locally on
Windows with a debugger attached to identify which native addon (esbuild, SWC,
better-sqlite3, etc.) is causing the stack corruption.

---

## Update 2026-05-12 — Current state

The `localhost` → `127.0.0.1` change has been applied across all 12 Playwright
configs and 3 test files. However, since the failures are flaky, a passing run
is **not** sufficient proof that the change fixed anything — several passing
runs could be coincidental.

Still open: the root cause of the server crash (PID change mid-run) and the
Apollo error during `/double` prerender remain uninvestigated.

---

## Update 2026-05-12 — Vite crash on `yarn cedar dev` + Windows + Node 24

### Evidence: Vite dev server dies mid-run after dependency re-optimization

From run
[25750099805](https://github.com/cedarjs/cedar/actions/runs/25750099805/job/75624312182)
(PR #1761, Windows dev smoke tests, Node 24):

```
[WebServer] web | 5:25:48 PM [vite]   ➜  Local:   http://localhost:8910/
[WebServer] web | 5:25:55 PM [vite] (client) ✨ new dependencies optimized: @cedarjs/forms
[WebServer] web | 5:25:55 PM [vite] (client) ✨ optimized dependencies changed. reloading
[WebServer] web | 5:26:03 PM [vite] (client) ✨ new dependencies optimized: humanize-string
[WebServer] web | 5:26:03 PM [vite] (client) ✨ optimized dependencies changed. reloading
[WebServer] web | yarn cross-env NODE_ENV=development cedar-vite-dev --no-open
                 exited with code 3221226505
```

### Chronology

| Time (UTC) | Event                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| 17:25:44   | Prisma client generation starts                                           |
| 17:25:48   | Vite web server starts and reports listening on port 8910                 |
| 17:25:52   | API server starts on port 8911, health check passes                       |
| 17:25:54   | Playwright begins running 7 tests using 1 worker                          |
| 17:25:55   | Vite re-optimizes for `@cedarjs/forms`, triggers reload                   |
| 17:26:00   | Test 1 passes: `authChecks` (2.5s)                                        |
| 17:26:03   | Vite re-optimizes for `humanize-string`, triggers reload                  |
| 17:26:04   | Test 2 passes: `authChecks` (4.4s), test 3 passes: `dev.spec.ts` (1.0s)   |
| 17:26:07   | **Vite crashes** — exit code `3221226505` (`STATUS_STACK_BUFFER_OVERRUN`) |
| 17:27:05   | Test 4 `rbacChecks` `beforeAll` hang starts (web server dead)             |
| 17:27:38   | `beforeAll` timeout (60s exceeded)                                        |
| 17:27:38   | All remaining tests fail with `ERR_CONNECTION_REFUSED`                    |

### Affected Tests (all 3 passed before crash, all 3 failed after)

| #    | Test                                                           | Status  |
| ---- | -------------------------------------------------------------- | ------- |
| 1    | `authChecks` — useAuth hook, auth redirects                    | ✅ pass |
| 2    | `authChecks` — requireAuth graphql checks                      | ✅ pass |
| 3    | `dev.spec.ts` — Smoke test with dev server                     | ✅ pass |
| 4    | `rbacChecks` — Should not be able to delete as non-admin       | ❌ fail |
| 5    | `rbacChecks` — Admin user should be able to delete (skipped)   | ⏭ skip |
| 6–15 | Retries of tests 4–5 + static assets (robots.txt, favicon.png) | ❌ fail |

### Failure breakdown per test

**`rbacChecks` (test 4–9, 3 attempts)**

- First attempt: `beforeAll` times out after 60s waiting to navigate to `/signup`. The error context shows `page.goto('/signup')` succeeded but `page.getByLabel('Username').fill(...)` got `Test ended` — meaning the page started loading but the dev server died before the form rendered.
- Retries 1–2: `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8910/signup`

**Static assets — `robots.txt` (test 10–12, 3 attempts)**

- All 3 attempts: `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8910/robots.txt`

**Static assets — `favicon.png` (test 13–15, 3 attempts)**

- All 3 attempts: `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8910/favicon.png`

### Key Observations

1. **The crash is the same `STATUS_STACK_BUFFER_OVERRUN` seen on React 18 + Windows**, but this is on the regular (React 19) track with Node 24.
2. The crash happens ~4 seconds **after** a Vite dependency re-optimization for
   `humanize-string`. The first re-optimization for `@cedarjs/forms` (at 17:25:55)
   did NOT crash — the server survived for 12 more seconds.
3. This was a **trivial PR** (comment-only change to a Prisma schema) — ruling
   out any code changes as the cause.
4. The server was fully functional for ~19 seconds before crashing — the first
   3 tests all passed with `page.goto()` navigation.
5. Unlike the earlier `cedar serve` crash (PID change mid-run from #1754), this
   is a `cedar dev` crash. The `dev` scenario uses Vite in dev mode with HMR,
   while `serve` serves pre-built assets. The crash trigger appears to be Vite's
   dependency pre-bundling/optimization step.

### What's Different from the React 18 Crash

- The React 18 crash (run 25729552439) happened **2 seconds after startup**, before
  any re-optimization — the initial dependency optimization already overflowed.
- This crash (run 25750099805) happened **after the initial optimization succeeded**,
  but a **second-wave** re-optimization (triggered by a page loading new dependencies)
  caused the overflow.
- Both are the same exit code `3221226505`, indicating the same class of native
  stack corruption.

### Updated Hypothesis (superseded — see root cause section below)

The `STATUS_STACK_BUFFER_OVERRUN` was initially hypothesized to be caused by
**esbuild** (Vite's dependency pre-bundler) overflowing the Windows 1MB default
stack during `node_modules` scanning. However, the GitHub issue search
(see [Root cause identified](#update-2026-05-12--root-cause-identified-v8-maglev-jit-bug-on-windows))
revealed the actual cause: V8's **Maglev** JIT compiler producing
stack-corrupting native code on Windows. The crash is a V8 bug, not an esbuild
or Vite bug — esbuild simply provides enough JavaScript execution to trigger
Maglev optimization of the vulnerable code paths.

### Recommendation

This finding partially answers two open questions from the initial investigation:

- **"Why does the server die permanently?"** — It doesn't die gracefully; it
  crashes with a native stack overflow. No recovery mechanism exists.
- **"Is the crash related to the React 18 downgrade?"** — No, it affects the
  main (React 19) dev smoke tests too.

The crash is **not isolated to React 18** — it affects the main smoke test
suite too. Next steps:

1. Run the test project locally with `yarn cedar dev` on Windows to verify
   reproducibility
2. Check if esbuild or Vite have known issues on Node 24 + Windows
   _(subsequently resolved — see root cause section below)_
3. As a temporary mitigation, consider making Windows smoke tests non-blocking
   or retry-on-failure in CI

---

## Update 2026-05-12 — Root cause identified: V8 Maglev JIT bug on Windows

### Upstream issue: nodejs/node#62260

A search for `STATUS_STACK_BUFFER_OVERRUN` / `0xC0000409` across GitHub
found a direct match:

- **[nodejs/node#62260](https://github.com/nodejs/node/issues/62260)** — "V8
  Maglev JIT causes STATUS_STACK_BUFFER_OVERRUN (0xC0000409) on Windows"

Key details from the issue:

- **Root cause**: V8's **Maglev** JIT compiler (enabled by default in Node 20+)
  triggers a stack corruption on Windows, causing the process to crash via
  `__fastfail` with exit code `-1073740791` (`0xC0000409`)
- **No JavaScript stack trace** — the crash is in native JIT-compiled code
- **Workaround**: `--no-maglev` flag eliminates the crash entirely
- **Not limited to Insider builds**: The latest comment (May 12, 2026 — today)
  confirms: _"I'm seeing this happen occasionally when running Node actions on
  GitHub's Windows Server 2025 runners"_ — exactly our environment
- Node.js collaborator [@joyeecheung](https://github.com/joyeecheung) confirmed
  the same crashes in Node.js CI: _"there are a bunch of tests related to HTTP
  crashing with the same code on Windows"_
- A Node.js PR ([#62272](https://github.com/nodejs/node/pull/62272)) attempted a
  fix but was **closed** with: _"Issues with the V8 compiler should be reported
  and fixed in V8. We shouldn't be hacking this at the embedder layer."_
- The Chromium issue tracker has a corresponding bug:
  [issues.chromium.org/issues/464515848](https://issues.chromium.org/issues/464515848)

### Why This Affects Cedar CI

1. **Node 24** is used on the Windows smoke test runner
2. Maglev has been enabled by default since Node 20.11, and its optimization
   aggressiveness increases with each V8 version
3. Vite and esbuild are JavaScript-heavy tools that exercise the JIT compiler
   heavily, making them likely to hit Maglev-compiled code paths
4. The crash timing (19 seconds after startup, during dependency
   re-optimization) is consistent with the issue description: _"crashes within
   20-70 seconds of startup"_
5. The non-deterministic nature (sometimes passes, sometimes crashes) is
   characteristic of JIT bugs — whether a particular code path gets Maglev
   optimization depends on runtime heuristics

### Why the `react-18` and `react` tracks both crash

The V8 Maglev crash is triggered by **any sufficiently complex JavaScript
execution**, not by React itself. Both the React 18 and React 19 test projects
trigger enough Vite/esbuild/Node.js activity to cause Maglev optimization of
the same underlying code paths. The crash is **environmental** (Node 24 +
Windows), not framework-dependent.

### Updated Recommendations

**Immediate mitigation (short-term):**

- Pass `--no-maglev` to `node` in the Playwright `webServer.command` or via an
  wrapper script. The flag **cannot** be set via `NODE_OPTIONS` — it must be
  passed directly to `node` on the command line:
  ```
  node --no-maglev node_modules/.bin/cedar dev --no-generate --fwd="--no-open"
  ```
  This disables only the Maglev tier while keeping TurboFan and `fetch()`
  functional.

**Long-term:**

- Monitor the upstream V8 fix in
  [issues.chromium.org/issues/464515848](https://issues.chromium.org/issues/464515848)
- Once fixed, it will be backported to Node.js via a V8 cherry-pick (similar to
  [#62784](https://github.com/nodejs/node/pull/62784) for a different Maglev
  bug)
- Remove the `--no-maglev` workaround after the fix lands in a Node 24.x
  release

---

## Update 2026-05-14 — Repeat of "Generating dbAuth secret" yarn failure

### Evidence

From run
[25850869052](https://github.com/cedarjs/cedar/actions/runs/25850869052/job/75957041258)
(PR #1775 `feat(gqlorm): Add web workspace setup steps`, CLI smoke tests on Windows):

```
$ cd D:\a\cedar\test-project
$ yarn install
➤ YN0000: Yarn detected that the current workflow is executed from a public pull request...
➤ YN0000: ┌ Resolution step
Generating dbAuth secret
Error: The process 'C:\npm\prefix\yarn.cmd' failed with exit code 1
    at ExecState._setResult (D:\a\cedar\cedar\node_modules\@actions\exec\lib\toolrunner.js:600:25)
```

### Assessment

This is the same failure mode logged on 2026-05-12 from run
[25732654425](https://github.com/cedarjs/cedar/actions/runs/25732654425/job/75561731517)
— `yarn install` in the test project fails with exit code 1 during the
Resolution step, with "Generating dbAuth secret" appearing concurrently in the
output.

PR #1775 is an unrelated feature addition (`gqlorm` web workspace setup), so
the failure is not caused by the PR changes. This is at least the second
occurrence across different PRs, confirming it is a recurring flaky failure on
the Windows CLI smoke test runner.

The "Generating dbAuth secret" line comes from a concurrent process step (test
project scaffolding), not from `yarn install` itself.

The actual yarn error from within the Resolution step is not visible — it is
swallowed inside a closed `##[group]Resolution step` log group. The failure
happens only ~2 seconds into the install, which rules out a native module build
failure (building from source via node-gyp takes much longer and occurs in the
Link step, not Resolution). Root cause is unknown. Possible candidates:

- Lockfile integrity check rejection (yarn 4 hardened mode is enabled for public PRs)
- A tarball referenced in the test project's `package.json` not yet available
- Network or filesystem error during package resolution

To investigate further, a re-run with verbose yarn output would be needed to
surface the actual error from within the resolution step.

---

## Update 2026-05-14 — Three new Windows failures in PR #1778 CI run

From run
[25856361532](https://github.com/cedarjs/cedar/actions/runs/25856361532)
(PR #1778 `fix: set output.exports: named in API Vite build`):

### 1. Fragments Smoke tests — "Generating dbAuth secret" yarn failure (again)

[Job 75975300598](https://github.com/cedarjs/cedar/actions/runs/25856361532/job/75975300598)

Identical to the pattern from runs 25732654425 and 25850869052:

```
➤ YN0000: ┌ Resolution step
Generating dbAuth secret
Error: The process 'C:\npm\prefix\yarn.cmd' failed with exit code 1
```

This is now the third occurrence across three different PRs (#1757, #1775, #1778),
confirming it is a recurring issue unrelated to any specific code change.

### 2. Background jobs E2E — yarn exit code 127

[Job 75975300609](https://github.com/cedarjs/cedar/actions/runs/25856361532/job/75975300609)

```
➤ YN0000: ┌ Resolution step
##[error]Process completed with exit code 127.
```

Exit code 127 means "command not found". The `yarn install` in the test project
fails ~1.4 seconds into the Resolution step with a different exit code than the
exit-code-1 failures. The command that cannot be found is not visible in the
logs. Possible cause: a postinstall script or yarn plugin calls a Windows command
that doesn't exist on the runner.

### 3. Smoke tests — Storybook crashes on startup (exit code 1)

[Job 75975300251](https://github.com/cedarjs/cedar/actions/runs/25856361532/job/75975300251)

The test project setup completes successfully, but the Playwright `webServer`
(Storybook) crashes 14 seconds after starting:

```
[WebServer] @storybook/core v8.6.18
[WebServer]
##[error]Process completed with exit code 1.
```

No error output is emitted between the version banner and the crash. Earlier in
the same job log, yarn warns:

```
YN0060: vite is listed by your project with version 7.3.2, which doesn't satisfy
what @storybook/builder-vite and other dependencies request (^4.0.0 || ^5.0.0 || ^6.0.0).
```

**Likely cause:** `@storybook/builder-vite` does not support Vite 7. Storybook
attempts to start, fails internally due to the incompatible Vite version, and
exits with code 1. This is different from the V8 Maglev JIT crash (which exits
with code `3221226505`).

**Next step:** Check if there is a newer version of `@storybook/builder-vite`
that supports Vite 7, or whether the test project's Storybook setup needs to be
pinned to a compatible Vite version.

**Update:** In the subsequent CI run (25858321273), the `Smoke tests /
windows-latest` job **passed** — the Storybook crash did not recur. This
suggests the exit-code-1 failure might have been a fluke (runner condition,
timing issue), or it self-resolved. The Vite 7 / Storybook incompatibility
warning is still present in later runs, but Storybook appears to start
successfully regardless. Needs more data points.

---

## Update 2026-05-14 — PR #1778 second CI run (25858321273)

From run
[25858321273](https://github.com/cedarjs/cedar/actions/runs/25858321273)
(PR #1778, re-triggered after fork push):

### 1. Smoke tests ESM / windows-latest — V8 Maglev JIT crash (again)

[Job 75981804553](https://github.com/cedarjs/cedar/actions/runs/25858321273/job/75981804553)

```
[WebServer] web | yarn cross-env NODE_ENV=development cedar-vite-dev --no-open
            exited with code 3221226505
```

Followed by `ERR_CONNECTION_REFUSED` on all subsequent `page.goto()` calls.
Same V8 Maglev JIT crash (`STATUS_STACK_BUFFER_OVERRUN`) as previously
documented. The `cedar-vite-dev` process running in ESM mode crashes mid-run,
taking down the web server.

### 2. RSC Smoke tests / ubuntu-latest — yarn install fails in RSC project

[Job 75981804767](https://github.com/cedarjs/cedar/actions/runs/25858321273/job/75981804767)

`create-cedar-rsc-app` scaffolds a new RSC project and immediately runs
`yarn install` inside it. The install fails after ~17 seconds:

```
⚠ Error: Couldn't install node modules
Error: Command failed with exit code 1: yarn install
```

This is on **Ubuntu**, not Windows, and it fails inside the newly created RSC
project (not the main cedar repo). Yarn 4 hardened mode is active. The actual
yarn error is not visible in the logs.

Notable: the prebuild cache was restored as `prebuild-cache-Linux-12.9.0`, but
the cedar repo now also includes `better-sqlite3@npm:12.10.0` alongside
`12.9.0`. If the RSC project template depends on the newer version, it would
not be covered by the cached 12.9.0 prebuild — though this would cause a link
step failure, not a resolution failure.

This failure mode (RSC project yarn install) has not been seen in prior runs.
Could be a transient network issue, a lockfile incompatibility introduced by
the version bump, or a hardened mode lockfile check rejection on the freshly
scaffolded project's lockfile.

---

## Update 2026-05-15 — 4th occurrence of "Generating dbAuth secret" failure + debug improvement

### New occurrence

From run
[25841578454](https://github.com/cedarjs/cedar/actions/runs/25841578454/job/75927972987)
(PR #1773 `feat(gqlorm)`, Background jobs E2E on Windows):

```
$ cd D:\a\cedar\test-project
$ yarn install
➤ YN0000: ┌ Resolution step
Generating dbAuth secret
Error: The process 'C:\npm\prefix\yarn.cmd' failed with exit code 1
    at ExecState._setResult (D:\a\cedar\cedar\node_modules\@actions\exec\lib\toolrunner.js:600:25)
```

Same pattern as runs 25732654425, 25850869052, and 25856361532 (PRs #1757,
#1775, #1778). This is now the 4th occurrence across 4 different unrelated PRs,
confirming it is a recurring environmental failure on Windows CI.

### What's actually failing

Despite the log appearance suggesting `yarn install` is the culprit, the failure
is in `yarn cedar g secret --raw`, not in `yarn install`. The sequence inside the
`set-up-test-project` action is:

1. `yarn project:tarsync --verbose` runs (which internally calls `yarn install`
   in the test project — this is the "Resolution step" shown in the log)
2. `console.log('Generating dbAuth secret')` fires **after** tarsync finishes
3. `yarn cedar g secret --raw` runs and fails with exit code 1 in ~0.5 seconds

The `yarn install` output from step 1 and the "Generating dbAuth secret" line
from step 2 appear interleaved in the GitHub Actions log due to log group
handling — this is misleading.

The actual failure in `yarn cedar g secret --raw` was invisible because it was
called with `silent: true`, which buffers stdout/stderr but doesn't stream them.
When `getExecOutput` throws on non-zero exit code, the buffered output is
discarded — so nothing about the actual error was logged.

### Debug improvement applied

Changed `.github/actions/set-up-test-project/setUpTestProject.mts`:

- Call `yarn cedar g secret --raw` with `ignoreReturnCode: true` instead of
  relying on the default throw behaviour
- On non-zero exit, explicitly log captured `stdout` and `stderr` before
  throwing a descriptive error
- Updated the `Args` TypeScript interface to expose `ignoreReturnCode?: boolean`
  in options and `exitCode: number` in the return type (the underlying
  `@actions/exec` `getExecOutput` already supports and returns both — the
  interface was just incomplete)

The next time this fails, the actual error output from yarn/Cedar CLI will be
visible in the CI log.

### Possible causes (still unknown)

- A module resolution error in the Cedar CLI when loading the `g secret` command
- A Windows path or permission issue with yarn's shim (`C:\npm\prefix\yarn.cmd`)
- A race condition or lock contention from the preceding `yarn install` not fully
  releasing file locks before `yarn cedar` starts
- A transient yarn registry or filesystem error on the Windows runner

---

## Update 2026-05-20 — Root cause of CLI smoke test failure identified

### Evidence from PR #1806

With the debug improvement from 2026-05-15 now active, the captured stdout from
`yarn cedar g secret --raw` was visible for the first time:

```
stdout: Internal Error: root-workspace-0b6124@workspace:.: This package doesn't
seem to be present in your lockfile; run "yarn install" to update the lockfile
    at DT.getCandidates (yarn.js:204:4607)
    at em.getCandidates (yarn.js:141:1311)
    ...
    at async e.resolveEverything (yarn.js:209:7138)
```

And, crucially, the preceding warning that was already present:

```
WARNING: yarn.lock was not created by tarsync!
```

### Root cause

The `__fixtures__/test-project` fixture has no committed `yarn.lock`. Tarsync is
responsible for creating it via `pmInstall`. When `yarn.lock` is absent, yarn 4's
hardened mode (active on public PRs) rejects any subsequent yarn invocation —
including `yarn cedar g secret --raw` — with "not present in your lockfile".

So the question becomes: **why does tarsync's `yarn install` step sometimes
fail to produce `yarn.lock`?**

The answer is the same V8 Maglev JIT bug documented above. The `yarn install`
call inside tarsync's `pmInstall` is a long-running process (58+ seconds in
observed runs). The JIT crash (`0xC0000409`) can occur at any point during that
execution. When it does, Node exits hard and `yarn.lock` is never written.

**Why tarsync silently absorbed the failure:** In verbose/CI mode (`verbose=true`
or non-TTY), `OutputManager` is constructed with `disabled=true`. Its `start()`
method returns early without setting `this.running = true`. Consequently, every
`outputManager.stop(error)` call also returns early (`!this.running`). The error
is stored in `this.error` but never rendered and never re-thrown — tarsync exits
with code 0 despite the failure.

### Why it's intermittent

The V8 Maglev JIT crash is non-deterministic. Whether a given code path gets
Maglev-compiled depends on runtime heuristics. Most runs complete the
`yarn install` before any vulnerable code path triggers JIT compilation at the
Maglev tier; occasionally it does, and the process hard-crashes.

### Fixes applied in this PR

**`tasks/framework-tools/tarsync/tarsync.mts`**

- Added `stageLog()` helper that emits plain `console.log` lines in verbose/CI
  mode, so each stage transition is visible in CI logs even when the spinner is
  disabled.
- Changed all `catch` blocks to re-throw after logging, so tarsync exits
  non-zero when any stage fails. Previously the error was absorbed and tarsync
  reported success.

**`tasks/framework-tools/tarsync/lib.mts`** (`pmInstall`)

- Added entry/exit console logs with elapsed time.
- Added a post-install lockfile existence check. If the lockfile is absent after
  `yarn install` returns, `pmInstall` now throws immediately with an explanation.
  This catches the case where the install process crashes but zx somehow sees a
  zero exit code (possible if the crash occurs in a subprocess that zx doesn't
  track directly).

**`.github/actions/set-up-test-project/setUpTestProject.mts`**

- Changed the "WARNING: yarn.lock was not created by tarsync!" path from a
  warning-and-continue to a hard throw. Failing fast here gives a clear error
  message with context, rather than the confusing downstream
  "not present in your lockfile" error from `yarn cedar g secret --raw`.
- Similarly, if `yarn.lock` exists but has no `root-workspace-` entry, now
  throws instead of warning.

---

## Update 2026-05-22 — Exit code 127 in `create-cedar-rsc-app` yarn install (PR #1811)

### Evidence

From run [26263998951](https://github.com/cedarjs/cedar/actions/runs/26263998951/job/77303444093)
(PR #1811 `chore(ci): Fix flaky cca tests`, Windows):

```
➤ YN0000: · Yarn 4.14.1
➤ YN0000: ┌ Resolution step
##[error]Process completed with exit code 127.
```

The failure occurs in the `set-up-job` action's `🐈 Yarn install` step, during
the second `yarn install --inline-builds` (for `packages/create-cedar-rsc-app`).
The process exits with code 127 ("command not found") approximately 2 seconds
into the Resolution step. The actual failing command is invisible because it's
inside a closed `##[group]` log block.

### Relation to previous entry

This is the same `create-cedar-rsc-app` yarn install that has been flaky. Exit
code 127 is distinct from the V8 Maglev JIT crash (exit code `3221226505`) —
it indicates a missing binary or command during dependency resolution.

The ~2 second window before the crash is suspicious: it's long enough for Yarn
to have started a subprocess (e.g. a lifecycle script or prebuild download) but
short enough to suggest the process was killed before doing meaningful work.

### Fixes applied

Two mitigations added to `.github/actions/set-up-job/action.yml`:

**1. Skip install on cache hit**

The `create-cedar-rsc-app` install step is now a separate step gated on a cache
miss:

```yaml
- name: 🐈 Yarn install (create-cedar-rsc-app)
  if: inputs.set-up-yarn-cache != 'true' || steps.set-up-yarn-cache.outputs.create-cedar-rsc-app-cache-hit != 'true'
```

The cache key covers `yarn.lock` + `package.json`, so a hit means the modules
are already correct. Skipping avoids the crash entirely on cache-hit runs.

**2. Retry on failure**

For cache-miss runs, the install retries up to 3 times with a 10s delay:

```bash
for i in 1 2 3; do
  yarn install --inline-builds
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then break; fi
  if [ $i -eq 3 ]; then exit $EXIT_CODE; fi
  echo "Attempt $i failed (exit $EXIT_CODE), retrying in 10s..."
  sleep 10
done
```

### Open questions

- What command triggers exit 127? (Not yet known — the failing command is inside
  a closed `##[group]` log block)
- Is this the same intermittent failure as the V8 crash, or a separate issue?

---

## Update 2026-06-26 — Exit code 127 in main workspace yarn install (PR #2000)

### Evidence

From run [28216733101](https://github.com/cedarjs/cedar/actions/runs/28216733101/job/83589389309)
(PR #2000 `fix(gql): Handle ERR_STREAM_PREMATURE_CLOSE`, Windows Smoke tests React 18):

```
➤ YN0000: · Yarn 4.14.1
➤ YN0000: ┌ Resolution step
##[error]Process completed with exit code 127.
```

The failure occurs in the `set-up-job` action's `🐈 Yarn install` step — the
**main workspace** `yarn install --inline-builds`, not the `create-cedar-rsc-app`
install. The process exits with code 127 approximately 1–2 seconds into the
Resolution step.

Key context from the logs:

- The `create-cedar-rsc-app` node_modules **cache hit** — so the gated
  `🐈 Yarn install (create-cedar-rsc-app)` step was correctly skipped
- The main workspace install (which has no retry logic) ran immediately after
  and crashed

### Relation to previous entry

Same exit-127 class of failure on Windows, same signature (`➤ YN0000: ┌
Resolution step` → `##[error]Process completed with exit code 127.`), but
affecting the **main workspace** `yarn install --inline-builds` rather than
the `create-cedar-rsc-app` install.

The mitigations applied in PR #1811 (cache-hit skip + retry) only cover the
`create-cedar-rsc-app` install step. The main workspace install still runs
without any retry.

### Fixes applied

None yet. A re-run of the job passed, confirming this is transient.

### Open questions

- Should the main workspace `yarn install --inline-builds` also get a retry
  loop on Windows?
- What command triggers exit 127 in the Resolution step? Still unknown — the
  failing command is inside a closed `##[group]` log block.

---

## Update 2026-06-26 — UD test harness startup race: esbuild service crash (Ubuntu)

### Evidence

From run
[28217399024](https://github.com/cedarjs/cedar/actions/runs/28217399024/job/83591358851?pr=2001)
(PR #2001 `feat(testing): Make testing work with prisma for yarn, npm and pnpm`):

```
Error: Hook timed out in 10000ms. If this is a long-running hook, pass a timeout
value as the last argument or configure it globally with "hookTimeout".
❯ vitest.setup.mts:46:1
```

The visible error is the `afterEach` hook (line 46) in `tasks/ud-tests/vitest.setup.mts`
timing out while cleaning up child processes. The underlying failure is an
esbuild crash during module loading in the unified dev server's startup:

```
"The service is no longer running"
```

This error originates from **esbuild** (`node_modules/esbuild/lib/main.js:893`),
not from Vite directly. It fires when the esbuild child process dies while
`ssrLoadModule` is loading `hello.ts` (in `apiDevMiddleware.ts:88`).

### Root cause analysis

1. **Esbuild's service is a global singleton** — a single child process shared
   across the entire Node.js process. `"The service is no longer running"` is
   thrown when `sendRequest` detects `closeData.didClose = true`, meaning the
   child process has exited. Vite itself never calls `esbuild.stop()`, so the
   crash is the child process dying (segfault, OOM, or resource pressure on CI).

2. **Failure sequence in the test:**
   - `udDev.test.mts` starts the unified dev server as a child process
   - `startApiDevMiddleware()` creates two ViteDevServer instances (API + web)
     and loads API functions via `ssrLoadModule`
   - If esbuild crashes during `ssrLoadModule`, the error is caught at
     `apiDevMiddleware.ts:136` and logged, but `hello.ts` is **never
     registered** in `LAMBDA_FUNCTIONS`
   - The web server starts anyway → `pollForReady` succeeds (SPA shell responds)
   - The request to `/.api/functions/hello` returns 404 → test assertion fails
   - `afterEach` runs: `p.kill()` (SIGTERM) → `await p`. If the dev server
     shutdown takes longer than 10s (e.g. Vite server.close() hangs), the
     hook times out, producing the message above.

3. **PR #2001 is unrelated** — it only touches `packages/testing/` (Vitest env +
   Jest setup for Prisma compat with different package managers). Zero overlap
   with UD infrastructure, esbuild, or the test fixture.

### Why it's a startup race

- The crash occurs during **startup** (`ssrLoadModule` in
  `internalLoadApiFunctions`), not during steady-state request handling or
  cleanup.
- Esbuild's child process crash is non-deterministic — it depends on CI runner
  resource pressure (memory, CPU contention) at the moment of startup.
- Two ViteDevServer instances are created in the same process; while the esbuild
  protocol is multiplexed by request ID and should be safe, both servers can
  trigger concurrent esbuild operations that increase the likelihood of
  triggering the crash.

### Recommendation

A re-run should clear it — this is a transient flaky test in the UD test
harness, not a code bug. For long-term hardening:

1. **Harden the `afterEach` hook** — the naive `p.kill()` + `await p` pattern
   hangs forever if SIGTERM is ignored. Use a grace-period race instead:
   ```
   p.kill('SIGTERM')
   await Promise.race([
     p.catch(() => {}),
     sleep(5000),
   ])
   if (p.exitCode === null) {
     p.kill('SIGKILL')
     await p.catch(() => {})
   }
   ```
2. **Increase the hook timeout** from the default 10s to 30s to account for
   slow Vite server shutdown on resource-constrained CI runners.

---

## Update 2026-07-17 — Open-PR + run-history survey: flakiest job identified

### Method

Surveyed all 10 open PRs targeting `main` plus the last ~40 `ci.yml` runs
(which cover recently merged branches). Each failing job was classified as
FLAKY (matching a documented signature) or REAL (genuine breakage) by reading
the failed-step logs, so that real regressions did not skew the flakiness tally.

### Flakiest job: `Smoke tests ESM / windows-latest`

The Windows ESM smoke-test job is the single job that fails most often purely
because it is flaky — 3 flaky failures in the sample, and **every one of its
failures was flaky, not a real regression**:

| Branch                                | Signature                                          |
| ------------------------------------- | -------------------------------------------------- |
| `tobbe-fix-gql-opts`                  | V8 Maglev crash / `ERR_CONNECTION_REFUSED` pattern |
| `renovate/eslint-monorepo`            | Builds fine, then bare `exit code 1` mid-setup     |
| `renovate/eslint-monorepo` (PR #2086) | Exit-127 in tarsync `buildTarballs`                |

None of those diffs (a GraphQL sourcemap fix, an eslint bump) can plausibly
affect a Windows smoke test — the hallmark of environmental flake.

### Windows is the flaky surface

Every genuinely flaky failure in the sample was on Windows:

| Normalized job                | Flaky failures | Signature                    |
| ----------------------------- | -------------- | ---------------------------- |
| Smoke tests ESM (windows)     | 3              | V8 Maglev / exit-127         |
| Build, lint, test (windows)   | 2              | All suites pass, then exit 1 |
| RSC Smoke tests (windows)     | 1–2            | prisma-generate setup crash  |
| Smoke tests (windows)         | 1              | V8 Maglev / dbAuth-secret    |
| Background jobs E2E (windows) | 1              | EPERM rename race            |

Ubuntu smoke/E2E jobs appear in raw counts only because they ride along on the
two `renovate/react-monorepo` real-failure runs (see below).

### Ruled out as REAL (not flaky)

The bulk of failing jobs across open PRs are genuine breakage, excluded from the
flakiness tally: #246 (React major bump — one `TS2322` in `@cedarjs/forms`
cascades to ~20 jobs), #2090 (`vite import-dir` plugin fails to transform the
`../directives/**/*.{js,ts}` glob, so the API server imports a literal glob path
and never boots — all 8 smoke/SSR/E2E failures share this one cause), #1855
(apollo ESM subpath breakage), #1942 (uncommitted `yarn.lock` → immutable-install
rejection), #1737 (Node 26 `better-sqlite3` node-gyp `distutils` removal), #1830
(prettier), #1780 (real `dbAuth.mockListr` unit-test failure).

### New candidate signatures (see below)

Two Windows environmental flakes surfaced that do not match existing signatures
A–E and are documented as new entries: an EPERM rename race and a
`prisma/config` module-resolution failure.

---

## Update 2026-07-17 — New signature: Windows EPERM rename of `package.json.bak`

### Evidence

From PR #2093 (`fix(deps): update @listr2/prompt-adapter-enquirer`, Background
jobs E2E on Windows):

```
Error: EPERM: operation not permitted, rename
'packages\api-server\package.json.bak' -> 'package.json'
```

The error fires during `generateTypesCjs`, failing the
`@cedarjs/api-server:build` task (`✖ ... Cache Miss`, `1 Failed Tasks`).

### Assessment

The build uses a package.json-swap trick (rename `package.json` to
`package.json.bak`, write a modified `package.json`, then rename back). On
Windows, `rename()` fails with `EPERM` when another handle holds the target
file open — an antivirus scan, a lingering `node` process, or a filesystem
indexer. This is a Windows file-lock race, not a code bug: the listr2 dependency
bump cannot affect the api-server build. Classified flaky (environmental).

**Possible mitigation:** retry the rename with a short backoff, or use a
copy-then-replace strategy that tolerates a transiently locked target.

---

## Update 2026-07-17 — New signature: `Cannot find module 'prisma/config'` in RSC Windows setup

### Evidence

From PR #2086 (`chore(deps): update eslint monorepo`, RSC Smoke tests on
Windows):

```
Cannot find module 'prisma/config'
```

Thrown while loading `prisma.config.ts`, causing
`prisma generate --config=...` to exit with code 1 during test-project setup.

### Assessment

The failure is in Prisma config module resolution during RSC project
scaffolding, unrelated to the eslint bump. Likely a resolution race or a
partially-installed `prisma` package on the Windows runner (the `prisma/config`
subpath export not yet linked when `prisma generate` runs). A re-run typically
clears it. Classified flaky (environmental); needs more data points to confirm
whether it is timing-dependent or a genuine `prisma` version/export mismatch on
Windows.

---

## Update 2026-07-17 — Aggregate flakiness stats: last 100 merged PRs

### Method

Sampled the **last 100 PRs merged into `main`** (95 unique head branches). For
each branch, collected every failed `ci.yml` run (182 failed runs total), then
extracted and log-classified **every failed job** (621 jobs, after excluding the
`✅ CI Status Check`, `🔍 Detect changes`, and `nx run-many` aggregate rollups).
Each job was labelled FLAKY (matched a known signature A–G below) or REAL
(genuine breakage — a real test/type/build error, a lint failure, or the
branch's own feature breaking). Because these branches all eventually merged
green, FLAKY here means a failure the branch's diff cannot plausibly have
caused; REAL captures the early-commit failures that were later fixed.

### Headline numbers

| Metric                                | Value             |
| ------------------------------------- | ----------------- |
| Merged PRs sampled                    | 100 (95 branches) |
| Failed CI runs on those branches      | 182               |
| Failed jobs classified                | 621               |
| **Flaky failures**                    | **172 (28%)**     |
| Real failures                         | 449 (72%)         |
| Merged branches with ≥1 flaky failure | **40 / 95 (42%)** |

Flaky failures by OS: **Windows 115 (67%)**, Ubuntu 31 (18%), OS-agnostic
(Universal Deploy / E2E-node) 26 (15%).

### Flakiest jobs (ranked by flaky-failure count)

| Job                             | Flaky | Total fails | Flaky rate |
| ------------------------------- | ----- | ----------- | ---------- |
| Smoke tests React 18 (windows)  | 29    | 33          | 88%        |
| Universal Deploy tests (ubuntu) | 27    | 43          | 63%        |
| Smoke tests (windows)           | 25    | 26          | **96%**    |
| Smoke tests ESM (windows)       | 18    | 22          | 82%        |
| Fragments Smoke tests (windows) | 14    | 19          | 74%        |
| RSC Smoke tests (windows)       | 14    | 17          | 82%        |
| E2E Node self-host (ubuntu)     | 10    | 22          | 45%        |
| Background jobs E2E (windows)   | 9     | 9           | **100%**   |
| CLI smoke tests (windows)       | 3     | 5           | 60%        |
| Smoke tests (ubuntu)            | 5     | 22          | 23%        |

Jobs that were **0% flaky** (every failure was real): Build/lint/test (ubuntu)
0/67, Check formatting (prettier) 0/39, Tutorial E2E 0/33, RSC Smoke (ubuntu)
0/20, E2E Vercel deploy 0/14, E2E Netlify deploy 0/14, CLI smoke (ubuntu) 0/14,
Server tests, Create Cedar App, constraints check.

### Flaky failures by signature

| Sig   | Description                                                                                | Count | % of flaky |
| ----- | ------------------------------------------------------------------------------------------ | ----- | ---------- |
| **A** | V8 Maglev crash `3221226505` / `ERR_CONNECTION_REFUSED` / webServer timeout (Windows)      | 90    | **52%**    |
| **D** | UD & E2E-node esbuild `"service is no longer running"` / `afterEach` hook timeout (Ubuntu) | 32    | 19%        |
| **B** | test-project setup: "Generating dbAuth secret" + `yarn.cmd` exit 1 / lockfile              | 18    | 10%        |
| **C** | Windows yarn/tarsync `exit 127` (Resolution step / `buildTarballs`)                        | 15    | 9%         |
| **E** | Storybook `exit 1` (Vite 7 incompat)                                                       | 9     | 5%         |
| **G** | `Cannot find module 'prisma/config'` (RSC Windows)                                         | 6     | 3%         |
| **F** | Windows `EPERM rename package.json.bak`                                                    | 2     | 1%         |

### Takeaways

1. **Windows smoke tests are the dominant flaky surface.** The top flaky jobs
   (except Universal Deploy) are all Windows `cedar dev`/`serve` smoke suites,
   and signature A (the V8 Maglev JIT bug, nodejs/node#62260) alone accounts for
   **52% of all flakiness**. `Smoke tests (windows)` failed flaky 96% of the
   time; `Background jobs E2E (windows)` 100%.
2. **`Smoke tests React 18 (windows)` is the single flakiest job by volume** (29
   flaky failures). The larger sample promotes it above `Smoke tests ESM
(windows)` from the 2026-07-17 single-snapshot survey — but all four Windows
   smoke variants (React 18, plain, ESM, Fragments) are effectively one problem.
3. **The second cluster is Ubuntu esbuild deaths (signature D, 19%)** — Universal
   Deploy tests (27 flaky, the biggest non-Windows source) and E2E-node
   self-host. Same root family as the `afterEach`/esbuild-service issue in the
   2026-06-26 UD entry.
4. **Highest-ROI mitigation:** pass `--no-maglev` to the Windows smoke-test
   `webServer` commands — it would remove ~52% of all observed flakiness in one
   change.

### Caveats

- Classification is signature-based. A handful of environmental infra failures
  (Neon `P1001` unreachable, canary-registry `ETARGET` / no-candidates, Netlify
  "configure site") do not match signatures A–G and were counted **REAL**, so
  the true flaky share is marginally under-counted.
- Refactor branches carrying genuine TS-error build cascades (a single build
  break failing all ~18–64 downstream jobs) correctly land in REAL — this is why
  `Build, lint, test (ubuntu)` shows 0% flaky despite 67 failures.

---

## Update 2026-07-18 — Applied mitigation: `--node-args` flag + `--no-maglev` from Windows CI

### What

Signature A (the V8 Maglev JIT crash, nodejs/node#62260) is 52% of all observed
flakiness. The fix is to run the affected node processes with `--no-maglev`,
which disables only the Maglev tier and eliminates the crash. `--no-maglev` is a
V8 flag, so it **cannot** be set via `NODE_OPTIONS` (node rejects V8 flags
there) — it must be passed directly to `node` on the command line.

The crashing processes are the web dev server that `yarn cedar dev` spawns via
`concurrently` — `cedar-vite-dev` (fallback mode) or `cedar-unified-dev` (unified
mode). Those bins are normally launched as package-manager shims, and a node flag
can't be forwarded through the shim, so the flag has to be on the command line of
the node process that actually runs the bin.

### How (chosen approach)

Two parts:

1. **A generic `cedar dev --node-args="..."` flag** that forwards arbitrary CLI
   args to the node process running the web/unified dev server (e.g. `--inspect`,
   `--max-old-space-size=8192`, or `--no-maglev`).
2. **CI passes `--node-args="--no-maglev"` on Windows** — the way an end user
   would — from the dev-type smoke-test Playwright configs.

`--no-maglev` is deliberately **not** hardcoded in the framework. Routing it
through the public flag means CI dogfoods the real mechanism end-to-end, and the
code path stays exercised even after Node fixes the Maglev bug and we drop the
flag from CI.

**Single launch path, no fallback.** `formatViteDevBinCommand(binName,
extraNodeArgs)` always builds an explicit `<launcher> <flags> "<binPath>"`
command (never the bin shim) and resolves the bin path via
`require.resolve('@cedarjs/vite/package.json')` (the `./bins/*.mjs` subpaths
aren't in the package's `exports` map, but `./package.json` is) joined with
`bins/<binName>.mjs`. `@cedarjs/vite` is a direct dependency of the CLI, so if
resolution fails the install is broken and dev can't run — it **throws** with a
clear message rather than silently degrading to a shim (which, on Windows, would
silently drop the Maglev mitigation and reintroduce the flakiness). One path,
continuously exercised on every `cedar dev`, so bugs surface immediately.

**No `cross-env`.** `NODE_ENV=development` is set via the `concurrently` job's
`env` (as the api and unified jobs already did), so the command is just
`<launcher> ... "<binPath>"`. Dropping `cross-env` removes a whole node process
from the chain — the explicit launch is now **leaner than the old bin-shim
command** (`yarn node "<path>"` = one yarn, vs the shim's `yarn cross-env … bin`
= yarn + a cross-env node process).

**Package-manager / Yarn PnP support.** The launcher is `yarn node` under Yarn
and bare `node` under npm/pnpm. This matters for **Yarn PnP**: there is no
`node_modules`, so the resolved bin path is a virtual path inside a Yarn cache
zip, and only `yarn node` loads the PnP runtime needed to resolve the bin's
imports and read that path. The path is resolved inside the CLI process, which
`yarn cedar dev` already launched with PnP active, so resolver and launcher
agree. Under the node-modules linker `yarn node` is just node-in-project; npm and
pnpm always have a real `node_modules` tree (pnpm's store is native
`node_modules`), so bare `node` is correct there.

**Why one branch, no fallback** (debated at length): a two-branch "shim when no
flags, explicit when flags" keeps the common path on the PM's shim, but the
explicit path then only runs when someone passes `--node-args` — so it rots and
its bugs surface late. One always-explicit path is continuously exercised (unit
tests + Windows smoke CI), never rots, and — once `cross-env` is dropped — is
also cheaper. A resolution fallback was rejected because a fallback that silently
drops `--no-maglev` is worse than a loud failure.

**Why not a bin-level re-exec guard** (the first thing tried): re-executing from
inside the bin adds a second supervisor node process per dev/serve, hides the
behaviour in a published bin, and creates a debugging footgun — with
`NODE_OPTIONS=--inspect` (inherited), both the supervisor and the re-exec'd child
try to bind the inspector port.

### Changed files

- `packages/cli/src/commands/dev.ts` — new `--node-args` option.
- `packages/cli/src/commands/dev/devHandler.ts` — `formatViteDevBinCommand()`
  (single explicit `node`/`yarn node` launch, `--node-args` passthrough, hard
  error on resolution failure, no `cross-env`). The bin entry point is read from
  `@cedarjs/vite`'s own `bin` field, so it covers `cedar-vite-dev`,
  `cedar-unified-dev`, **and** `cedar-dev-fe` (streaming SSR, a compiled `dist/`
  entry — previously a TODO). `NODE_ENV` moved to the web job's `env`.
- `packages/cli/src/commands/dev/__tests__/dev.test.ts` — updated web/unified/
  streaming/npm/pnpm assertions to the explicit-launch, no-`cross-env` shape;
  added tests for `--node-args` forwarding (web + unified).
- `tasks/smoke-tests/basePlaywright.config.mts` — `windowsNoMaglevDevArgs`
  export (` --node-args="--no-maglev"` on Windows, else empty).
- `tasks/smoke-tests/{dev,fragments-dev,rsc-dev,streaming-ssr-dev}/playwright.config.ts`
  — append `windowsNoMaglevDevArgs` to the `cedar dev` webServer command.

### Verified

- `require.resolve('@cedarjs/vite/package.json')` resolves from the CLI
  (`@cedarjs/vite` is a runtime `dependency`); the bin subpath does _not_ resolve
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`), confirming the package.json-based derivation
  is necessary. Node follows the symlink to the real path, so it works under the
  hoisted (npm/yarn) and symlinked (pnpm) layouts alike.
- `yarn node` exists in Yarn 4 (Cedar pins `yarn@4.14.1`) and forwards args to
  node (`yarn node --help` prints node's help).
- `eslint` + `prettier --check` clean; `tsc` reports no new errors in the changed
  files (the two `dev.ts` `TS2578` "unused @ts-expect-error" diagnostics
  pre-date this change); all 15 `dev.test.ts` unit tests pass (covering yarn, npm
  and pnpm launch shapes). The unit-test job also runs on `windows-latest`.

### Not yet validated

Verified structurally (command shape, resolution, PM handling, tests) but **not**
yet run against a real Windows CI runner or a Yarn-PnP project — those need a
branch + CI run.

### Still to wire (follow-ups)

Covers all three `cedar dev` web crashers (`cedar-vite-dev`,
`cedar-unified-dev`, and `cedar-dev-fe` streaming SSR). The remaining
signature-A surfaces use different entry points and a more tangled launch path:

- `cedar serve` web server — `cedar-serve-fe` (`packages/vite/dist/runFeServer.js`)
  and the `@cedarjs/web-server` bins (`cedar-web-server` / `rw-web-server`,
  `packages/web-server/dist/bin.js`); the `serve` command itself
  (`packages/cli/src/commands/serve.ts`) also serves in-process via `srvx` /
  `serveWebHandler`. Covers the `serve`, `fragments-serve`, `prerender`, `rsa`,
  `rsc`, `streaming-ssr-prod` suites.
- The api-server watch bins (`cedar-api-server-watch` / `cedarjs-api-server-watch`).
- `cedar storybook` (signature is less clear there — Storybook also has the
  Vite 7 incompat, signature E).

Note: signature D (Ubuntu esbuild `"service is no longer running"` in UD /
E2E-node tests) is **not** a Maglev crash and is unaffected by `--no-maglev` — it
needs the separate `afterEach`/esbuild hardening from the 2026-06-26 UD entry.

## Update 2026-07-21 — Root cause identified and fixed: canary-registry `ETARGET` / no-candidates

### What

The "Caveats" section above (2026-07-17 survey) flagged `canary-registry
ETARGET` / no-candidates as an unclassified environmental infra failure,
counted as REAL rather than attributed to a known flaky signature. Root cause:
`.github/scripts/publish-prerelease.mts` (then named `publish-canary.sh`)
published packages to the `canary`/`next`
npm dist-tag **one package at a time**. Any CI job that upgraded to canary
(`yarn cedar upgrade -t canary`, `create-cedar-app@canary`, etc.) while a
publish run was mid-loop could resolve the dist-tag to a version for which
some sibling packages hadn't been published yet — an install-time `ETARGET`
("no candidates found") failure that had nothing to do with the code under
test.

### How (fix)

`publish-prerelease.mts` now publishes in two phases instead of moving the
real tag as it goes:

1. **Stage**: every public package is published in parallel (bounded
   concurrency, default 4) under a staging tag unique to the version being
   published (`staging-<version>`). Nothing resolves this tag, so a
   partially-complete run is invisible to consumers watching `canary`/`next`.
2. **Flip**: only once every package has published successfully does the
   script move the real `canary`/`next` dist-tag onto that version for every
   package, in parallel (bounded concurrency, default 8). This is the single
   point where the new version becomes visible — and it's atomic-ish across
   packages instead of trickling in one at a time.
3. **Cleanup**: the staging tag is removed afterward (best-effort, non-fatal).

Both the publish and dist-tag-flip steps retry with exponential backoff +
jitter on rate-limit-shaped errors (429, timeouts, connection resets), to stay
within npm registry rate limits despite the added parallelism.

### Changed files

- `.github/scripts/publish-prerelease.mts` (renamed from `publish-canary.mts`
  — it publishes both the `canary` and `next` tags) — staged publish +
  dist-tag flip, bounded concurrency, retry with backoff.
- `.github/workflows/publish-prerelease.yml` (renamed from
  `publish-canary.yml`) — same rename rationale, job id renamed
  `publish-canary` -> `publish-prerelease`.

### Not yet validated

Verified via `tsc`, `eslint`, and `prettier` locally. Needs a real canary
publish run on `next` (or `main`) to confirm the staged publish + flip behaves
correctly against the live npm registry, and a following CI run that upgrades
to canary to confirm the race is gone.

### Reference

PR: https://github.com/cedarjs/cedar/pull/2147
