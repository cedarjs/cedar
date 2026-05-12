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
Apollo error during `/double` prerender remain uninvestigated. If flakiness
continues, those are the next areas to focus on.
