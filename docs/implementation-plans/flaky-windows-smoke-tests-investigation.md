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
