# Node.js Debugger Integration in `--ud` Mode

**Date:** 2026-06-29
**Updated:** 2026-07-01 (see investigation at
`docs/implementation-plans/debugger-breakpoints-investigation.md`)

## Problem

Attaching a Node.js debugger to a Cedar app running in Universal Deploy (`--ud`)
mode does not work. The `--debug-port` flag passed to `cedar dev --ud` is
silently ignored by `cedar-unified-dev`, and `NODE_OPTIONS="--inspect=<port>"`
opens the inspector on the wrong process (the CLI parent, not the Vite server).

## Root Cause

The `cedar-unified-dev.ts` entry point parses `--port`, `--apiPort`, and
`--debug` via yargs-parser, but never parsed `--debug-port`. The flag fell
through into the `...serverArgs` rest spread and was passed to Vite's server
config, which ignored it.

Additionally, `NODE_OPTIONS="--inspect=<port>"` cannot work because Cedar's
architecture has two Node.js processes in the tree:

1. The cedar CLI process (parent)
2. The `cedar-unified-dev` process (child, where API functions execute)

`NODE_OPTIONS` applies to **every** Node.js process spawned from that
environment. The parent CLI binds to the inspector port first, and the child
process fails with a port conflict.

## Fix

In `packages/vite/src/cedar-unified-dev.ts`:

- Added `'debug-port'` to the yargs-parser `number` config
- Extracted argument parsing into an exported `parseCliArgs()` helper
- Extracted inspector activation into an exported `openDebugger(port)` helper
  that dynamically imports `node:inspector` (keeping it out of the bundle when
  unused)
- Destructured `debugPort` from parsed args and called `openDebugger(debugPort)`
  before starting the Vite server

This opens the inspector on the one process where API functions actually
execute.

## Vite SSR Module Loading and the V8 Inspector

### Summary

A subsequent investigation (see
`docs/implementation-plans/debugger-breakpoints-investigation.md`) tested
breakpoints with a real editor (Zed) via a CDP proxy. **Breakpoints work
correctly on Vite SSR-loaded API functions.** The earlier theory that source
files don't appear as V8 scripts or that scripts are garbage-collected was
disproven. The debug adapter's `urlRegex` approach (matching both `file://` and
bare paths) successfully matches Vite SSR scripts, and breakpoints bind, fire,
and resolve to correct source locations.

The sections below are preserved for historical context but the conclusions
should be considered superseded by the investigation document.

### Historical analysis (pre-investigation)

When writing an integration test for this feature, we discovered that
`viteServer.ssrLoadModule()` (used by `apiDevMiddleware.ts` to load API
functions) does **not** expose individual source files as V8 scripts.

The call chain is:

1. `startApiDevMiddleware()` calls `loadApiFunctions(viteServer)`
2. `loadApiFunctions()` calls
   `viteServer.ssrLoadModule(pathToFileURL(fnPath).href)`
3. `ssrLoadModule()` compiles the TypeScript via Vite's transform pipeline and
   evaluates it within Vite's module graph

The result: individual source files like `hello.ts` never appear in
`Debugger.scriptParsed` events. They are compiled and evaluated as part of
Vite's internal module graph, not as standalone V8 scripts.

### Why `Debugger.setBreakpointByUrl` appeared not to work

`Debugger.setBreakpointByUrl` matches against V8 script URLs. Since the API
function source files never appear as scripts, the URL regex can never match
them. The CDP command returns a `breakpointId` (it doesn't error), but the
breakpoint is never actually resolved to any script.

We confirmed this by collecting all `Debugger.scriptParsed` URLs — they are
exclusively `file://` URLs from `node_modules/` and Cedar's own `dist/`
directories. No function source files appear.

**This analysis was incorrect.** The CDP proxy test later confirmed that:

- The debug adapter sends `urlRegex` (matching both `file://` and bare paths)
- V8 successfully matches (`locs=1`) against Vite SSR scripts
- Breakpoints fire and stepping works at correct source locations

The key difference is that the debug adapter connects before modules load (via
`--debug-brk` or attach-by-port), whereas the test connected after module
loading had already completed.

### Vite SSR module runner internals

Vite 7 uses a custom SSR module runner (not `import()` or `require()`) that
evaluates transformed code via `new AsyncFunction()`. This creates a V8
`Script` with a URL set via `//# sourceURL=...`.

Key characteristics:

- Script URL is the original file path (e.g. `/Users/.../hello.ts`), set via
  `//# sourceURL` comments added by Vite's transform pipeline
- The script is fully synchronous — the module is parsed, executed, and its
  exports cached in one shot
- After execution, the V8 `Script` is retained in the module runner's cache

### The `--debug-brk` / Session-based pause approach

For `--debug-brk`, the debugger must be connected and given time to set
breakpoints **before** modules load. The mechanism uses `inspector.Session`
internally:

1. `inspector.open()` opens the WebSocket port
2. `inspector.waitForDebugger()` blocks until the debugger sends
   `Runtime.runIfWaitingForDebugger`
3. Since editors (VS Code, Chrome DevTools) send `Debugger.enable` before
   `Runtime.runIfWaitingForDebugger`, the `Debugger` domain is already active
   when `waitForDebugger()` unblocks
4. An internal `inspector.Session` is created and connected
5. `Debugger.enable` and `Debugger.pause` are posted via the Session
6. A trivial `Runtime.evaluate({ expression: '1' })` is fired to force V8 to
   execute JavaScript — this causes V8 to check the debugger pause flag and
   actually pause, broadcasting `Debugger.paused` to all sessions
7. The internal Session waits for `Debugger.resumed`
8. The external debugger (VS Code, Chrome DevTools) receives `Debugger.paused`
   — the user sets breakpoints and clicks Resume
9. `Debugger.resume` is sent → V8 resumes → `Debugger.resumed` is broadcast to
   all sessions
10. The internal Session's `Debugger.resumed` event fires → the internal
    Session is disconnected → `loadApiFunctions()` runs → SSR modules load
    with breakpoints attached

The key insight is that `Debugger.pause` alone is insufficient. It arms a flag
saying "pause at the next JavaScript statement," but after `waitForDebugger()`
unblocks, V8 is idle in the event loop with no JavaScript to execute — the
pause flag is never checked. The `Runtime.evaluate` trigger forces V8 to
execute something, which causes the pause check to run immediately.

This approach avoids showing framework code to the user — the pause is
initiated via the internal CDP Session, not via a `debugger;` statement in
source code.

### Comparison of CDP approaches

| Approach                             | Works with Vite SSR? | Notes                                                                   |
| ------------------------------------ | -------------------- | ----------------------------------------------------------------------- |
| `Debugger.setBreakpointByUrl`        | Yes                  | Debug adapter sends `urlRegex` which matches Vite SSR scripts           |
| `Debugger.setBreakpoint` (scriptId)  | Yes (fallback)       | Used when `hasSourceURL = true`; works but lost on HMR                  |
| `Debugger.pause()`                   | Yes                  | Pauses at next statement execution                                      |
| Session + `Runtime.evaluate` trigger | Yes                  | Forces pause when idle event loop prevents `Debugger.pause` from firing |

### Practical debugging approaches that work

For actual debugging of SSR-transformed API functions, two approaches work:

1. **Attach by port** (simplest): Run `cedar dev --ud`, then attach the editor
   debugger to the inspector port (default 18911 or the `--debug-port` value).
   Breakpoints bind immediately.

2. **`--debug-brk`**: Run `cedar dev --ud --debugBrk`. The dev server pauses
   at startup and waits for the debugger. After attaching, click Resume to
   load API functions with breakpoints attached.

Both approaches work with both legacy `handler` and modern `handleRequest`
function signatures.

## Why `NODE_OPTIONS` doesn't work for targeted inspection

When running `NODE_OPTIONS="--inspect=<port>" yarn cedar dev --ud`:

1. Node.js reads `NODE_OPTIONS` and opens the inspector on the cedar CLI process
   (port bound)
2. The CLI spawns `cedar-unified-dev` as a child process
3. The child inherits `NODE_OPTIONS` from the environment
4. The child tries to open its own inspector on the same port
5. **Port conflict** — the child's inspector fails to bind

The parent CLI process has the inspector, but it's useless for debugging API
functions because functions execute in the child `cedar-unified-dev` process.

`cedar-unified-dev.ts` preserves `process.env.NODE_OPTIONS` (via
`getDevNodeOptions()` in `devHandler.ts`), which appends `--enable-source-maps`.
If the user passes `NODE_OPTIONS="--inspect"`, both processes get it.

## Implications for testing

The `--debug-port` integration test (`cedar dev --ud --debug-port`) verifies the
inspector is functional via three complementary checks:

| Step                 | Assertion                         | Method                                             |
| -------------------- | --------------------------------- | -------------------------------------------------- |
| Inspector opens      | Port matches `--debug-port` value | stderr regex parse                                 |
| CDP messaging        | `1 + 1` evaluates to `2`          | `Runtime.evaluate`                                 |
| Debugger halts       | `debugger;` pauses execution      | `Runtime.evaluate` + `Debugger.paused` event       |
| Execution resumes    | Expression returns `42`           | `Debugger.resume` + await evaluate promise         |
| Request interruption | API call completes after pause    | `Debugger.pause()` armed before fetch + verify 200 |

The request-interruption check arms `Debugger.pause()` **before** issuing the
fetch, rather than sleeping and then pausing. This is deterministic: a trivial
handler (e.g. `hello.ts` returning a static response) can complete in well under
a fixed delay, which would leave the pause pending forever and time out the
test. Arming the pause first guarantees V8 halts on the next statement the dev
server executes.

The test distinguishes between "the inspector/debugger works" (proven) and
"breakpoints on SSR modules fire" (currently not provable via a post-startup CDP
session, for the reasons above).

### Process management and stdin lifecycle

The dev server is spawned with zx's `$` template and tracked via
`testContext.processes`, which is cleaned up in `afterEach` (see
`vitest.setup.mts`). The inspector URL is read from the spawned process's stderr
stream (`devProcess.stderr.on('data', ...)`, which zx exposes as a `Readable`).

A pitfall to avoid if spawning manually: `stdio: ['ignore', 'pipe', 'pipe']`
causes the dev server to exit immediately. When stdin is connected to
`/dev/null` (the `'ignore'` option), the stream ends instantly and Vite's event
loop drains because there are no active handles keeping it alive. Use
`stdio: ['pipe', 'pipe', 'pipe']` (or rely on zx, which handles this) to keep
stdin open and the event loop alive.

### V8 Inspector WebSocket URL

The V8 inspector's WebSocket URL includes a UUID path:

```
Debugger listening on ws://127.0.0.1:38911/5d3f0a7f-0e71-454c-bbc3-be145c3d7b4b
```

The `ws` WebSocket library (and the CDP handshake) requires the full URL
including the UUID. Connecting to `ws://127.0.0.1:38911` without the UUID
returns HTTP 400. The test parses the full URL from stderr using a regex that
captures the UUID.

The test uses distinct ports (18920/18921/38911) to avoid conflicts with the
existing test block, though tests run serially (`singleThread: true`).

## Files Changed

| File                                                    | Change                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/vite/src/cedar-unified-dev.ts`                | Parse `--debug-port`, call `inspector.open()` via `openDebugger()` |
| `packages/vite/src/__tests__/cedar-unified-dev.test.ts` | Unit tests for `parseCliArgs` and `openDebugger`                   |
| `package.json` (root)                                   | Add `ws` as devDependency                                          |
| `yarn.lock` (root)                                      | Reference `ws` from the root workspace                             |
| `tasks/ud-tests/udDev.test.mts`                         | Add `createCdpSession` helper and `--debug-port` integration test  |
| `packages/cli/src/commands/dev.ts`                      | Add `--debug-brk` yargs option                                     |
| `packages/cli/src/commands/dev/devHandler.ts`           | Thread `debugBrk` through to cedar-unified-dev command string      |
| `packages/vite/src/cedar-unified-dev.ts`                | Parse `'debug-brk'`, pass to `openDebugger(waitForDebugger=true)`  |
| `packages/vite/src/__tests__/cedar-unified-dev.test.ts` | Tests for `debugBrk` flag parsing and `waitForDebugger` behavior   |
| `tasks/ud-tests/udDev.test.mts`                         | `--debug-brk` integration test                                     |

## Related

- `apiDevMiddleware.ts` — `loadApiFunctions()` uses `ssrLoadModule()` to load
  API functions into Vite's module graph
- `serverManager.ts` — Non-UD mode properly handles `--debug-port` via
  `fork()` + `execArgv`
- `apiDebugFlag.ts` — CLI translates `--apiDebugPort` to `--debug-port` for
  `cedar-unified-dev`
