# Node.js Debugger Integration in `--ud` Mode

**Date:** 2026-06-29

## Problem

Attaching a Node.js debugger to a Cedar app running in Universal Deploy (`--ud`)
mode does not work. The `--debug-port` flag passed to `cedar dev --ud` is
silently ignored by `cedar-unified-dev`, and `NODE_OPTIONS="--inspect=<port>"`
opens the inspector on the wrong process (the CLI parent, not the Vite server).

A secondary issue surfaced while testing: even once the inspector is open on the
correct process, **static breakpoints set on Vite SSR-loaded API functions never
fire**. This doc covers both the fix and the breakpoint limitation.

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

### The issue

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

### Why `Debugger.setBreakpointByUrl` doesn't work

`Debugger.setBreakpointByUrl` matches against V8 script URLs. Since the API
function source files never appear as scripts, the URL regex can never match
them. The CDP command returns a `breakpointId` (it doesn't error), but the
breakpoint is never actually resolved to any script.

We confirmed this by collecting all `Debugger.scriptParsed` URLs — they are
exclusively `file://` URLs from `node_modules/` and Cedar's own `dist/`
directories. No function source files appear.

### Source map line number mismatch

There is a second, independent reason breakpoints miss. Vite's SSR transform
pipeline wraps user module code (e.g. `hello.ts`, 6 lines) into a generated
JavaScript module (~18 lines) with a Vite SSR runtime wrapper. The wrapper
occupies the first 3 generated lines (0, 1, 2), which have **no** source-map
mappings back to the original TypeScript source.

Using `Debugger.setBreakpoint` with `lineNumber: 1` (targeting
`return new Response(...)` in the original TS) resolves to **generated line 2**
— inside the Vite SSR wrapper, not inside `handleRequest`. V8 adjusts the
breakpoint from line 1 → 2 because line 1 has no executable bytecode.

The source map for `hello.ts` decodes (VLQ segments) as:

```
;;; => generated lines 0, 1, 2: NO MAPPINGS (Vite SSR wrapper)
AAAA,... => generated line 3: maps to original line 0 (function signature)
AACrD,... => generated line 4: maps to original line 1 (return statement)
...       => generated lines 5-8: map to rest of original source
```

Key findings from the source map:

- `lineNumber: 3` (generated) → function declaration line
- `lineNumber: 4` (generated) → first statement inside function body
  (`return new Response(...)`)
- The breakpoint must be on **generated** line 4+ to land inside
  `handleRequest`, not on **original** source line 1

### V8 script lifecycle for SSR modules

The deeper issue: even if set at the correct generated line, the breakpoint may
never fire because the V8 `Script` object for the SSR module is
garbage-collected before the CDP session connects.

Timeline:

1. Dev server starts → `loadApiFunctions()` calls
   `viteServer.ssrLoadModule(pathToFileURL(fnPath).href)` → V8 parses the
   SSR-transformed code → `Debugger.scriptParsed` fires (but no CDP client is
   connected yet)
2. Script is fully executed, `handleRequest` is extracted into
   `LAMBDA_FUNCTIONS`, and the `Script` object becomes eligible for V8 GC
3. CDP client connects and calls `Debugger.enable` → V8 re-emits `scriptParsed`
   for all known, uncollected scripts
4. If the `Script` was GC'd (very likely between steps 2 and 3 on a busy
   startup), `hello.ts` is NOT re-emitted
5. `Debugger.setBreakpointByUrl` with `urlRegex: "hello\\.ts"` or
   `Debugger.setBreakpoint` with its old `scriptId` cannot resolve against the
   now-invalid `Script`
6. The breakpoint is stored but never maps to any function; it never fires

This matches the observed test output: only one script (empty URL) collected
after `Debugger.enable` — `hello.ts` is absent. Force-loading via
`Runtime.evaluate` with `import('file://...hello.ts')` creates a **new** V8
`Script` from Node.js's ESM loader (separate from Vite's SSR module runner),
which is a different script object — breakpoints on it wouldn't fire when Vite's
handler calls the original function.

### Vite SSR module runner internals

Vite 7 uses a custom SSR module runner (not `import()` or `require()`) that
evaluates transformed code via `new Function()` or similar. This creates a V8
`Script`, but the script's lifecycle is tied to the module runner's internal
cache, not Node.js's module system.

Key characteristics:

- Script URL is the original file path (e.g. `/Users/.../hello.ts`), set via
  `//# sourceURL` comments added by Vite's transform pipeline
- The script is fully synchronous — the module is parsed, executed, and its
  exports cached in one shot
- After execution, the function reference is held in `LAMBDA_FUNCTIONS`, but the
  V8 `Script` can be GC'd because no active closure references the script's
  source

### Why this differs from VS Code / Chrome DevTools

Real debuggers (VS Code, Chrome DevTools) connect to the inspector **before**
user code runs. Two common setups:

1. **`--inspect-brk`:** Node.js pauses on the first line of execution, giving
   the debugger time to set breakpoints on all scripts before any module loading
2. **`--inspect` at spawn time:** The debugger is connected by the time the
   first `import()` or `require()` runs, so `scriptParsed` events are captured
   before scripts are GC'd

In Cedar's case, `inspector.open(debugPort, '127.0.0.1')` is called **during**
server startup, after Vite is initialized but before `loadApiFunctions()`
completes. However, by the time a test or external tool connects via WebSocket,
the SSR module scripts have already been loaded and potentially GC'd.

### The solution: `Debugger.pause()` (for connected sessions)

`Debugger.pause()` tells V8 to pause at the **next JavaScript statement
execution**, regardless of how the code was loaded. This works with Vite's SSR
pipeline because:

1. `Debugger.pause()` is sent (armed)
2. An HTTP request triggers the API function handler (or any JS executes)
3. V8 pauses when the next statement begins executing
4. The test asserts the pause event, then calls `Debugger.resume()`
5. The HTTP response completes

This approach is robust against Vite's module caching, TypeScript transforms,
the source-map line mismatch, and any future changes to how `ssrLoadModule`
works.

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

| Approach                               | Works with Vite SSR? | Notes                                                                   |
| -------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `Debugger.setBreakpointByUrl`          | No                   | Source files don't appear as V8 scripts                                 |
| `Debugger.setBreakpoint` (by scriptId) | No                   | Same reason — no scriptId for function files                            |
| `Debugger.pause()`                     | Yes                  | Pauses at next statement execution                                      |
| `Debugger.breakOnExceptions`           | Partially            | Only pauses on thrown exceptions                                        |
| Session + `Runtime.evaluate` trigger   | Yes                  | Forces pause when idle event loop prevents `Debugger.pause` from firing |

### Practical debugging approaches that work

For actual debugging of SSR-transformed API functions, connect the inspector
**before** the dev server loads SSR modules:

```
yarn node --inspect=127.0.0.1:38911 packages/vite/dist/cedar-unified-dev.js ...
```

Or use a deferred-loading mechanism where the CDP client must be connected
before `loadApiFunctions()` proceeds. This is how VS Code's `launch.json` works.

For ad-hoc inspection without breakpoints, the current `--debug-port`
implementation is sufficient for:

- Profiling (CPU/memory via Chrome DevTools' Profiler tab)
- `Runtime.evaluate` for live inspection
- `Debugger.pause()` / `Debugger.resume` for halting execution on demand
- Console.log debugging (which appears in the stderr output, not through the
  inspector)

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
