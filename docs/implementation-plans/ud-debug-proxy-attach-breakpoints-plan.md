# Plan: Debug Proxy for Attach-Workflow Breakpoints in UD Mode

## Summary

When a user attaches a debugger to `yarn cedar dev --ud`, breakpoints on API
functions don't fire. The modules have already been loaded via Vite's
`ssrLoadModule()` at startup, and the V8 `Script` objects are eligible for
garbage collection by the time the debugger connects — so pending URL
breakpoints never attach.

This plan introduces a **WebSocket proxy** on the debug port. When a debugger
connects, the proxy transparently forwards CDP traffic to the real inspector
**and** simultaneously invalidates Vite's SSR module cache + reloads API
functions. The next request re-evaluates the modules with the debugger
connected, so `scriptParsed` fires fresh and pending breakpoints attach.

This solves the **attach workflow** (the common case: user starts dev server,
sees something wrong, attaches debugger, sets breakpoints, reloads) without
requiring the user to manually save files or use `--inspect-brk`.

## Goals

- Breakpoints set in an editor **fire on the next request** after attaching a
  debugger to a running `yarn cedar dev --ud` server
- No change to the user's workflow — they attach as they normally would
  (`Debugger: Attach to Node Process` in VS Code, `chrome://inspect` in Chrome)
- The proxy is transparent — editors see a standard CDP WebSocket endpoint, no
  editor-specific configuration needed
- Source maps continue to work — the editor translates original TS lines to
  generated JS lines as before
- Non-blocking when no debugger is connected — the dev server runs normally
- The existing `--debug-port` flag and `inspector.open()` behavior are preserved
  as the underlying mechanism

## Non-Goals

- Replacing `inspector.open()` with `--inspect` via `execArgv` — the UD spawn
  path uses `concurrently` (shell-based `spawn`, not `fork`), so `execArgv`
  can't reach the child. `inspector.open()` is the right approach for UD mode.
- Supporting `--inspect-brk` (break before any code runs). This is a separate
  feature that would use `inspector.waitForDebugger()`. It helps the **launch**
  workflow (editor starts the process) but not the **attach** workflow (user
  attaches to a running process). See "Future Work" below.
- Fixing breakpoint persistence across HMR reloads. Vite's HMR already
  re-evaluates modules on file change, which causes pending breakpoints to
  attach. This plan covers the gap between "server started" and "user edits a
  file."
- Non-UD mode. Attach already works there because Node's native `import()`
  caches modules in a way that prevents V8 from GC'ing the `Script` objects.
  Vite's `ssrLoadModule()` has no equivalent persistence.

## Current State

### How `--debug-port` works today

1. User runs `yarn cedar dev --ud --apiDebugPort 18911`
2. CLI builds a shell command string:
   `cross-env NODE_ENV=development cedar-unified-dev --port 8910 --apiPort 8911 --debug-port 18911`
3. `concurrently` spawns it via `child_process.spawn('/bin/sh', ['-c', cmd])` —
   **not** `fork()`, so no `execArgv`
4. `cedar-unified-dev.ts` calls `inspector.open(18911, '127.0.0.1')` at
   `packages/vite/src/cedar-unified-dev.ts:72-74`
5. `startApiDevMiddleware()` runs immediately after, calling
   `loadApiFunctions(viteServer)` at `packages/vite/src/apiDevMiddleware.ts:436`
6. `loadApiFunctions()` calls `viteServer.ssrLoadModule()` for each API function
   at `packages/vite/src/apiDevMiddleware.ts:88`
7. Server is up. Modules are loaded and cached in `LAMBDA_FUNCTIONS`.

### Why breakpoints don't fire after attach

- `ssrLoadModule()` evaluates transformed code via `new Function()` inside
  Vite's SSR module runner, creating a V8 `Script`
- Only the exported function references are retained in `LAMBDA_FUNCTIONS`
- The V8 `Script` objects themselves have no lingering references and are
  eligible for GC
- When the debugger connects later and calls `Debugger.enable`, V8 re-emits
  `scriptParsed` only for uncollected scripts — the API function scripts are
  gone
- `Debugger.setBreakpointsByUrl` registers the breakpoint as **pending** (URL
  pattern match), but it only attaches when a matching script is loaded
- The only thing that triggers a fresh `ssrLoadModule()` is HMR — a file change
  on disk. See `setupHmrHandlers()` at
  `packages/vite/src/apiDevMiddleware.ts:258-331`

### How HMR invalidation works today

`setupHmrHandlers()` in `apiDevMiddleware.ts` listens for file changes:

1. `viteServer.watcher.on('change')` fires
2. `viteServer.moduleGraph.invalidateModule(mod)` is called for the changed
   module and all its importers (lines 280-293)
3. `loadApiFunctions(viteServer)` is called to re-evaluate all functions
   (line 296)

There is also a standalone helper `invalidateApiModules()` at line 234 that
invalidates **all** modules under `api.src` — used by the `add` and `unlink`
handlers (lines 312-313, 329-330).

### Existing invalidation API

The key functions we can reuse:

- `invalidateApiModules(viteServer, normalizedApiSrc)` — invalidates all modules
  under `api.src` in Vite's module graph (`apiDevMiddleware.ts:234-256`)
- `loadApiFunctions(viteServer)` — re-imports all API functions via
  `ssrLoadModule()` (`apiDevMiddleware.ts:35-50`)

### Non-UD mode: why attach works there

Non-UD uses Node's native `import()` to load functions
(`packages/api-server/src/plugins/lambdaLoader.ts:56`):

```ts
const fnImport = await import(pathToFileURL(fnPath).href)
```

Node's module cache holds a reference to the module's `Script`, preventing GC.
When the debugger attaches and calls `Debugger.enable`, all cached scripts are
re-emitted via `scriptParsed`, and breakpoints attach to existing scripts.

## Architecture

### The WebSocket proxy

```
Editor (VS Code / Chrome DevTools)
  │
  │  WebSocket: ws://127.0.0.1:18911/<uuid>
  │
  ▼
┌─────────────────────────────────┐
│  Debug Proxy (ws proxy)         │
│  - listens on debugPort         │
│  - on connection:               │
│    1. invalidate SSR modules    │
│    2. reload API functions      │
│    3. forward CDP bidirectionally│
└─────────────────────────────────┘
  │
  │  WebSocket: ws://127.0.0.1:<random>/<uuid>
  │
  ▼
┌─────────────────────────────────┐
│  V8 Inspector (node:inspector)  │
│  - opened on random port        │
│  - inspector.open(0, ...)       │
└─────────────────────────────────┘
```

The proxy sits between the editor and the real V8 inspector. CDP is just JSON
over WebSocket, so forwarding is trivial — parse nothing, just pipe bytes
through. The proxy's only intelligence is the `connection` event handler, which
triggers module invalidation before forwarding begins.

### Why a proxy instead of a CDP event listener

We need to know **when** a debugger connects. Options:

1. **CDP `Runtime.executionContextCreated` / `Debugger.enable`** — requires
   parsing CDP messages, maintaining protocol state, and the inspector doesn't
   emit a "client connected" event natively.
2. **WebSocket connection event** — the proxy owns the WebSocket server, so it
   gets a `connection` event for free. No CDP parsing needed. The proxy is
   protocol-agnostic — it forwards raw bytes.

Option 2 is simpler, more robust, and doesn't couple to CDP protocol versions.

### Why `inspector.open(0)` instead of `inspector.open(debugPort)`

The proxy needs to listen on `debugPort` (the user-facing port). The inspector
can't share that port — it's a WebSocket server itself. So the inspector opens
on a random port (`0`), and the proxy forwards to it. `inspector.url()` returns
the full `ws://127.0.0.1:<random>/<uuid>` URL for forwarding.

## Implementation Steps

### Step 1: Export invalidation + reload from `apiDevMiddleware.ts`

Currently `invalidateApiModules()` is a private function and
`loadApiFunctions()` is exported. Export a combined helper:

```ts
// packages/vite/src/apiDevMiddleware.ts

export async function invalidateAndReloadApiFunctions(
  viteServer: ViteDevServer
): Promise<void> {
  const normalizedApiSrc = normalizePath(getPaths().api.src)
  invalidateApiModules(viteServer, normalizedApiSrc)
  await loadApiFunctions(viteServer)
}
```

This is the same sequence the HMR `add`/`unlink` handlers already call (lines
312-313, 329-330), just extracted into a reusable function.

### Step 2: Rewrite `openDebugger()` as a proxy in `cedar-unified-dev.ts`

Replace the current `openDebugger()`:

```ts
// Current (packages/vite/src/cedar-unified-dev.ts:50-53)
export async function openDebugger(port: number) {
  const inspector = await import('node:inspector')
  inspector.open(port, '127.0.0.1')
}
```

With a proxy-based version:

```ts
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'

export function openDebugger(
  debugPort: number,
  onConnect?: () => void | Promise<void>
): { close: () => void } {
  const inspector = require('node:inspector')

  // Open the real inspector on a random internal port
  inspector.open(0, '127.0.0.1')
  const inspectorUrl = inspector.url()

  if (!inspectorUrl) {
    throw new Error('Failed to open V8 inspector')
  }

  // Create a WebSocket proxy on the user-facing debug port
  const server = createServer()
  const wss = new WebSocketServer({ server })

  wss.on('connection', async (clientWs) => {
    // Debugger attached — invalidate SSR modules so the next request
    // re-evaluates them with the debugger connected and breakpoints armed
    if (onConnect) {
      try {
        await onConnect()
      } catch (err) {
        // Log but don't block the debugger connection
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[debug-proxy] invalidation failed: ${message}`)
      }
    }

    // Forward CDP traffic bidirectionally
    const inspectorWs = new WebSocket(inspectorUrl)

    inspectorWs.on('message', (data) => clientWs.send(data))
    clientWs.on('message', (data) => inspectorWs.send(data))

    inspectorWs.on('close', () => clientWs.close())
    clientWs.on('close', () => inspectorWs.close())

    inspectorWs.on('error', () => clientWs.close())
    clientWs.on('error', () => inspectorWs.close())
  })

  server.listen(debugPort, '127.0.0.1')

  return {
    close: () => {
      wss.close()
      server.close()
      inspector.close()
    },
  }
}
```

The `onConnect` callback is what triggers module invalidation — it's passed in
by `startUnifiedDevServer()` so `openDebugger` stays decoupled from the Vite
server.

### Step 3: Wire up the `onConnect` callback in `startUnifiedDevServer()`

Currently `openDebugger(debugPort)` is called **before**
`startApiDevMiddleware()` (line 73 vs line 82), so the Vite server doesn't exist
yet. The proxy needs the Vite server to invalidate modules.

Two options:

**Option A: Defer proxy start until after Vite server exists**

```ts
const startUnifiedDevServer = async () => {
  // ... parse args ...

  const {
    close: closeApi,
    handler: apiHandler,
    viteServer,
  } = await startApiDevMiddleware()

  // Now the Vite server exists — start the debug proxy with invalidation
  let debugProxy: { close: () => void } | undefined
  if (debugPort) {
    debugProxy = openDebugger(debugPort, async () => {
      const { invalidateAndReloadApiFunctions } =
        await import('./apiDevMiddleware.js')
      await invalidateAndReloadApiFunctions(viteServer)
    })
  }

  // ... rest of server setup ...
}
```

**Option B: Start proxy immediately, defer invalidation via a stored ref**

Start the proxy (which starts listening but doesn't invalidate) before the Vite
server exists. Store the Vite server reference once it's created. The
`onConnect` callback checks if the ref is populated.

Option A is cleaner — the inspector opens a few milliseconds later (after
`startApiDevMiddleware()` instead of before), but that's negligible. The only
risk is if `startApiDevMiddleware()` takes a long time and the user tries to
attach during that window — but the server isn't ready then anyway.

**Recommendation: Option A.**

### Step 4: Return `viteServer` from `startApiDevMiddleware()`

Currently `startApiDevMiddleware()` returns `{ viteServer, close, handler }` at
`apiDevMiddleware.ts:428-446` — **it already returns the Vite server**. No
change needed here.

### Step 5: Clean up the proxy on server shutdown

Add the proxy's `close()` to the existing shutdown path:

```ts
// In startUnifiedDevServer(), in the shutdown/cleanup section:
if (debugProxy) {
  debugProxy.close()
}
```

## Edge Cases

### Debugger connects before server is ready

If the user attaches during `startApiDevMiddleware()` (before
`loadApiFunctions()` completes), the `onConnect` invalidation runs but
`loadApiFunctions()` is already in flight. `loadApiFunctions()` has a guard for
this at `apiDevMiddleware.ts:36-49`:

```ts
if (loadApiFunctionsInFlight) {
  needsReloadAfterInFlight = true
  return
}
```

So the invalidation's `loadApiFunctions()` call will queue up and run after the
initial load completes. The `needsReloadAfterInFlight` flag ensures the reload
happens. This is already handled.

### Multiple debugger connections

If the user disconnects and reconnects, the `connection` event fires again,
invalidating modules again. This is correct — each reconnection should get fresh
scripts with breakpoints armed.

Chrome DevTools opens multiple WebSocket connections (one for the page target,
sometimes one for the service worker). Each connection triggers invalidation.
This is wasteful but harmless — `invalidateApiModules()` is idempotent, and
`loadApiFunctions()` has the in-flight guard.

If this becomes a performance concern, we can debounce: only invalidate on the
**first** connection after a disconnect, or throttle to one invalidation per N
seconds.

### `inspector.url()` returns `undefined`

`inspector.url()` returns `undefined` if the inspector isn't open. The proxy
code checks for this and throws. This should never happen since we call
`inspector.open(0)` immediately before, but the guard prevents a silent crash.

### No debugger ever connects

The proxy listens on the debug port but never blocks. If no debugger connects,
the server runs normally. `inspector.open(0)` starts the inspector in the
background — it's non-blocking. The only overhead is the HTTP server listening
on the debug port, which is negligible.

### Existing `NODE_OPTIONS="--inspect=..."` usage

If the user passes `NODE_OPTIONS="--inspect=<port>"`, both the CLI parent and
the `cedar-unified-dev` child will try to open the inspector. The child's
`inspector.open(0)` (random port) won't conflict with the `NODE_OPTIONS` port,
but the parent's inspector is useless for debugging API functions. This is the
existing behavior — the proxy doesn't change it. The `--debug-port` flag is the
correct mechanism.

## Testing

### Unit tests (`cedar-unified-dev.test.ts`)

Update the existing `openDebugger` test to account for the proxy:

- Mock `node:inspector`, `node:http`, and `ws`
- Verify `inspector.open(0, '127.0.0.1')` is called (not the user-facing port)
- Verify the HTTP server listens on the user-facing `debugPort`
- Verify `onConnect` is called when a WebSocket connection is made
- Verify CDP messages are forwarded bidirectionally
- Verify `close()` cleans up all resources

### Integration test (`udDev.test.mts`)

Add a new test block: `cedar dev --ud --debug-port (attach workflow)`:

1. Start dev server with `--debug-port 38911` (existing setup)
2. Wait for server to be ready (`pollForReady`)
3. Make an initial request to `/.api/functions/hello` — confirms the server
   works and the module is loaded + cached
4. Connect CDP session to `ws://127.0.0.1:38911` (through the proxy)
5. Enable the debugger (`Debugger.enable`)
6. Set a breakpoint by URL on `hello.ts`:

   ```ts
   await cdp.send('Debugger.setBreakpointsByUrl', {
     lineNumber: 0, // function declaration line
     url: 'file://' + helloTsPath,
     columnNumber: 0,
     condition: '',
   })
   ```

7. Make a request to `/.api/functions/hello`
8. Wait for `Debugger.paused` event — **this is the assertion that was
   previously impossible**
9. Verify call frames include `handleRequest`
10. Resume and verify the HTTP response

This test proves the proxy + invalidation works end-to-end: the breakpoint fires
on a module that was loaded **before** the debugger connected, without any file
edits.

### Existing integration test

The existing `cedar dev --ud --debug-port` test (Runtime.evaluate, debugger;
statement, Debugger.pause during request) should continue to pass unchanged —
the proxy is transparent to CDP messaging.

## Dependencies

- `ws` (WebSocket) — **already added** as a devDependency in the impl-3 branch.
  Used for both the CDP test client and the proxy server.
- `node:http` — built-in, no new dependency
- `node:inspector` — built-in, already used

## Files to Change

| File                                                    | Change                                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/vite/src/apiDevMiddleware.ts`                 | Export `invalidateAndReloadApiFunctions()`                                                                        |
| `packages/vite/src/cedar-unified-dev.ts`                | Rewrite `openDebugger()` as WebSocket proxy; move call after `startApiDevMiddleware()`; pass `onConnect` callback |
| `packages/vite/src/__tests__/cedar-unified-dev.test.ts` | Update `openDebugger` tests for proxy behavior                                                                    |
| `tasks/ud-tests/udDev.test.mts`                         | Add attach-workflow integration test with `setBreakpointsByUrl`                                                   |

## Future Work

### `--debug-brk` for the launch workflow

Add a `--debug-brk` flag that calls `inspector.waitForDebugger()` after
`inspector.open()`. This blocks until a debugger attaches, then proceeds. Useful
for VS Code `launch.json` configurations where the editor starts the process and
connects automatically. This is orthogonal to the proxy — it helps a different
workflow (launch, not attach) and can be added independently.

### Lazy function loading

Don't call `loadApiFunctions()` at startup. Load each function on its first
request. This would make the proxy's invalidation unnecessary for the **first**
request to each function — the module loads fresh with the debugger already
connected. However, it doesn't help for subsequent requests (the function is
cached after the first load). The proxy is still needed for the "reload after
seeing broken output" workflow.

### Streaming SSR mode

Streaming SSR has its own dev server setup (`devFeServer.ts`) that bypasses
`cedar-unified-dev`. The proxy would need to be wired into that path separately
if debugger support is needed there.

## Related

- `packages/vite/src/apiDevMiddleware.ts` — `loadApiFunctions()`,
  `invalidateApiModules()`, `setupHmrHandlers()`
- `packages/vite/src/cedar-unified-dev.ts` — `openDebugger()`,
  `startUnifiedDevServer()`
- `packages/cli/src/commands/dev/apiDebugFlag.ts` — `--debug-port` flag
  generation
- `packages/api-server/src/serverManager.ts` — non-UD mode uses `fork()` +
  `execArgv` with `--inspect=<port>`
- `docs/implementation-docs/2026-06-29-debug-port-inspector-ud-mode.md` —
  background on why breakpoints don't fire with `ssrLoadModule()`
