# Debugger Breakpoints Investigation: `cedar dev --ud` Source Maps & CDP

## Summary

An investigation into whether breakpoints work correctly when debugging API
function source files (`.ts`) in `cedar dev --ud` mode. The investigation
covered:

- Source map chain correctness through Babel `enforce:'pre'` transforms
- Vite SSR module evaluation and `//# sourceURL=` format
- Debug adapter (vscode-js-debug) CDP behavior when setting breakpoints
- The `hasSourceURL` flag and its effect on breakpoint binding

**Conclusion:** Breakpoints work correctly. No issues were found. Both the
`urlRegex` and script ID breakpoint approaches used by the debug adapter
successfully bind to Vite SSR modules. Source maps are correctly chained
through the Babel transform. The call frame URL is empty (`url=none`) in
paused events, but this does not prevent breakpoint functionality.

---

## System Architecture

### 1. Cedar Dev Server (UD Mode)

```
cedar dev --ud
  │
  ├─ ViteDevServer (created via createServer)
  │   ├─ Plugin pipeline
  │   │   ├─ enforce:'pre' plugins
  │   │   │   └─ cedar-api-babel-transform (Babel)
  │   │   ├─ normal plugins
  │   │   │   └─ vite:esbuild (strips TypeScript)
  │   │   └─ enforce:'post' plugins
  │   └─ SSR module evaluation (ssrLoadModule)
  │       └─ inlineSourceMap() appends sourceURL + sourceMappingURL
  │
  └─ Node Inspector / CDP
      └─ openDebugger() connects and manages debugger session
```

### 2. API Function Loading

In `packages/vite/src/apiDevMiddleware.ts`, API functions are loaded via:

```typescript
const mod = await viteServer.ssrLoadModule(pathToFileURL(fnPath).href)
```

Each function file goes through the Vite transform pipeline:

1. Read from disk → raw TypeScript source (`originalCode`)
2. `enforce:'pre'` → Cedar's Babel plugin transforms the code
3. `vite:esbuild` (normal phase) → strips remaining TypeScript
4. Other transforms → handle imports, HMR, etc.
5. SSR transform (`ssrTransformScript`) → rewrites imports/exports for SSR
6. `inlineSourceMap` → appends `//# sourceURL` and `//# sourceMappingURL`

### 3. The Babel `enforce:'pre'` Plugin

Defined in `apiDevMiddleware.ts`:

```typescript
{
  name: 'cedar-api-babel-transform',
  enforce: 'pre',
  async transform(code, id) {
    const result = await transformWithBabel(code, id, babelPlugins, true)
    return { code: result.code, map: result.map ?? null }
  },
}
```

The `enforce: 'pre'` phase runs **before** `vite:esbuild`. This is necessary
because `vite:esbuild` strips TypeScript (removes type annotations, etc.), and
the Babel plugins need to see the original TypeScript AST to operate correctly.

#### Why even use Babel?

Cedar's Babel transforms run in **two different paths**: the Vite dev server and
the production esbuild build.

| Path             | Tool     | Where Babel Runs                               |
| ---------------- | -------- | ---------------------------------------------- |
| `cedar dev --ud` | Vite SSR | `enforce:'pre'` Vite plugin → calls Babel      |
| `cedar build`    | esbuild  | `prebuildApiFile` → calls Babel before esbuild |

The seven Cedar-specific transforms:

| Plugin                    | What It Does                                           |
| ------------------------- | ------------------------------------------------------ |
| `context-wrapping`        | Wraps exported handlers with async context isolation   |
| `directory-named-import`  | Rewrites import paths for directory-named modules      |
| `import-dir`              | Expands glob imports into individual namespace imports |
| `job-path-injector`       | Injects path/name into `.createJob()` calls            |
| `otel-wrapping`           | Wraps exported functions with OpenTelemetry spans      |
| `gqlorm-inject`           | Injects gqlorm schema into GraphQL handler setup       |
| `graphql-options-extract` | Extracts `createGraphQLHandler` options into an export |

The `enforce:'pre'` ordering is needed because Vite's `vite:esbuild` (normal
phase) strips TypeScript types and can rewrite module format. The Babel plugins
pattern-match on specific AST structures (`export async function handler(...)`,
`createGraphQLHandler(...)` calls, import specifier strings) and need to see the
original source tree with original positions for correct source map generation.
Babel's `@babel/preset-typescript` strips types **after** the Cedar plugins run,
inside the same pass — producing one combined source map.

Rewriting these as Vite plugins is technically feasible. **However, this is
irrelevant to the breakpoint problem.** The root cause — the URL format mismatch
in V8 — comes from Vite's `inlineSourceMap` function, which sets
`//# sourceURL=` to a bare path regardless of what transforms ran before it.
Whether the pre-SSR transform is Babel (`enforce:'pre'`), a Vite plugin
(`enforce:'post'`), or nothing at all, the script URL format stays the same and
the breakpoint URL matching fails identically.

The discussion of Babel vs Vite plugins is orthogonal to the actual issue.

The Babel plugin calls `transformWithBabel` (in
`packages/babel-config/src/api.ts`):

```typescript
export const transformWithBabel = async (
  sourceCode: string,
  filename: string,
  plugins: TransformOptions['plugins'],
  sourceMaps: TransformOptions['sourceMaps'] = 'inline'
) => {
  const result = transformAsync(sourceCode, {
    ...defaultOptions,
    filename,
    sourceMaps,
    plugins,
  })
  return result
}
```

Key detail: `sourceMaps: true` for Vite callers (returns `.map` separately),
defaulting to `'inline'` for esbuild callers.

---

## The Source Map Chain

### How Vite's SSR Transform Generates Source Maps

In `ssrTransformScript` (Vite 7.3.5, source at
`node_modules/vite/dist/node/chunks/config.js:15443`):

```javascript
async function ssrTransformScript(code, inMap, url, originalCode) {
  const s = new MagicString(code)
  // ... parse AST, modify imports/exports ...
  // ... walk AST, rewrite identifiers ...

  let map
  if (inMap?.mappings === '') {
    map = inMap
  } else {
    map = s.generateMap({ hires: 'boundary' })
    map.sources = [path.basename(url)]
    map.sourcesContent = [originalCode]
    if (
      inMap &&
      inMap.mappings &&
      'sources' in inMap &&
      inMap.sources.length > 0
    ) {
      map = combineSourcemaps(url, [map, inMap])
    }
  }

  return { code: s.toString(), map, ssr: true, deps, dynamicDeps }
}
```

Step-by-step:

1. `code` = the transformed code from the Babel `enforce:'pre'` plugin
2. `inMap` = the source map returned by the Babel plugin (maps Babel output →
   original source)
3. `originalCode` = the original file content read from disk (NOT the Babel
   output)
4. MagicString `s` is initialized with `code` (Babel output) and applies
   SSR-specific modifications
5. `s.generateMap()` produces an identity source map from SSR output → SSR input
   (Babel output)
6. `map.sources` is set to the basename (e.g., `typescript.ts`)
7. `map.sourcesContent` is set to `originalCode` (the original file content from
   disk)
8. `combineSourcemaps(url, [map, inMap])` chains the SSR map → Babel map

The `combineSourcemaps` function uses `@ampproject/remapping` to properly chain:

- First map: SSR output → SSR input (Babel output)
- Second map: Babel output → original source

### What Happens for Modules Without Imports/Exports

For a simple module like:

```typescript
const x: number = 0
```

1. Babel strips type annotation → `const x = 0;\n`
2. SSR transform finds no imports/exports → MagicString makes no modifications
3. `s.generateMap()` returns an identity map (no-op)
4. `inMap` (Babel map) correctly maps `const x = 0;` → `const x: number = 0;`
5. Combined: SSR output (`const x = 0;`) → original source
   (`const x: number = 0;`) ✓
6. `sourcesContent` = original TypeScript ✓

**The source map chain is correct for simple modules.**

### What Happens for Modules With Imports/Exports

For a module with imports (the common case for API functions):

```typescript
import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({...})
```

1. Babel transforms: wraps handler, injects context, strips types
2. SSR transform (ssrTransformScript) rewrites:
   - `import` → `const __vite_ssr_import_0__ = await __vite_ssr_import__(...)`
   - `export` → `__vite_ssr_export__("handler", () => handler)`
   - Other AST-level transformations
3. MagicString tracks all text modifications
4. `s.generateMap()` maps SSR output positions → Babel output positions
5. `combineSourcemaps` chains: SSR output → Babel output → original source

**The source map chain should also be correct here**, provided `remapping`
correctly handles the chain. The Vite source maps test in
`packages/vite/src/__tests__/sourcemaps.test.ts` verifies this with two
real-world scenarios using `@jridgewell/trace-mapping`.

---

## Root Cause: URL Matching in V8

### Script URL Format

When `inlineSourceMap` appends the final output, it sets:

```javascript
result.code = `${code.trimEnd()}
//# sourceURL=${mod.id}
//# sourceMappingSource=vite-generated
//# sourceMappingURL=data:application/json;base64,...`
```

`mod.id` is the **absolute file path** as a bare POSIX path (no `file://`
prefix):

```
//# sourceURL=/Users/user/my-project/api/src/functions/hello/hello.ts
```

### What the Editor Sends

When a user opens a file and sets a breakpoint, the editor's debug adapter
(`vscode-js-debug`) converts the local file path to a `file://` URL and
then generates a **regex** that matches both the `file://` URL and the
bare POSIX path form. It sends `Debugger.setBreakpointByUrl` with the
`urlRegex` parameter, not the exact `url` parameter.

From `vscode-js-debug/src/adapter/breakpoints/breakpointBase.ts`:

```typescript
const urlRegexp =
  await this._manager._sourceContainer.sourcePathResolver.absolutePathToUrlRegexp(
    this.source.path
  )
await this._setByUrlRegexp(thread, urlRegexp, lineColumn)
```

The generated regex looks like:

```
file:///Users/foo/project/app\.js($|\?)|/Users/foo/project/app\.js($|\?)
```

This matches **both** `file:///Users/.../app.js` and `/Users/.../app.js`.

The `urlToRegex` function (in `src/common/urlUtils.ts`) produces this
alternation:

```typescript
for (const str of [
  decodeURIComponent(unescapedPath),
  fileUrlToAbsolutePath(unescapedPath),
]) {
  // ... builds regex pattern for each form
}
```

**However**, there's a critical exception. In `breakpointBase.ts`
(`_setForSpecific` method), scripts that have `hasSourceURL === true`
are handled differently:

```typescript
if (
  script.url &&
  !script.hasSourceURL &&
  (!script.embedderName || script.embedderName === script.url)
) {
  // prefer URL-based breakpoints — survive reload
  return this._setByUrl(thread, script.url, lineColumn)
} else {
  // fall back to script ID breakpoints — lost on reload
  return this._setByScriptId(thread, script, lineColumn)
}
```

**Every Vite SSR module has `hasSourceURL = true`** because
`inlineSourceMap` adds `//# sourceURL=...` to the evaluated code. This
causes the debug adapter to **always use `setBreakpointByScriptId`**
instead of URL-based breakpoints. Script ID breakpoints work initially
but are **lost on HMR reload** (the script ID changes).

The identity source map from Vite PR #13514 does NOT change this
behavior — the `//# sourceURL=` comment is still present, so
`hasSourceURL` remains `true`.

### The `hasSourceURL` Problem

Every Vite SSR module has `hasSourceURL = true` (set by V8 when it
parses `//# sourceURL=...`). In vscode-js-debug's `_setForSpecific`
method, scripts with `hasSourceURL = true` skip URL-based breakpoints:

```typescript
if (script.url && !script.hasSourceURL && ...) {
  return this._setByUrl(thread, script.url, lineColumn);  // survives reload
} else {
  return this._setByScriptId(thread, script, lineColumn);  // lost on reload
}
```

This means the debug adapter **uses `setBreakpointByScriptId` for all
Vite SSR modules**. Script ID breakpoints work initially but are lost
when the module is reloaded (HMR) because the script ID changes. The
identity source map from PR #13514 does NOT change this — the
`//# sourceURL=` comment remains, so `hasSourceURL` stays `true`.

However, this only affects _script-specific_ breakpoints. The _path-based_
breakpoint flow (what happens when a user sets a breakpoint on a file)
uses `urlRegex` via `_setByPath`, which is independent of `hasSourceURL`.
So the `hasSourceURL` flag should NOT prevent path-based breakpoints
from binding.

### Path-Based Breakpoints Use `urlRegex`

When a user sets a breakpoint on a local file, the debug adapter follows
`_setByPath`:

```typescript
const urlRegexp =
  await this._manager._sourceContainer.sourcePathResolver.absolutePathToUrlRegexp(
    this.source.path
  )
await this._setByUrlRegexp(thread, urlRegexp, lineColumn)
```

The generated regex matches both the `file://` URL and the bare POSIX
path:

```
file:///Users/foo/project/app\.ts($|\?)|/Users/foo/project/app\.ts($|\?)
```

This is passed to `Debugger.setBreakpointByUrl` with the `urlRegex`
parameter. V8 checks all scripts against this regex — and it should
match Vite's bare-path script URLs.

**The path-based breakpoint flow should work without any changes.**
This casts doubt on the "URL format mismatch" theory. If the urlRegex
matches bare path URLs, then the actual cause of breakpoint failures
may be something else entirely — perhaps a timing issue (scripts loaded
before debugger attaches), garbage collection of anonymous `AsyncFunction`
scripts, or incorrect source map line mappings.

---

## Relevant Upstream Vite Issues & PRs

| Issue/PR                                              | Title                                                                  | Relevance                                                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#12944](https://github.com/vitejs/vite/issues/12944) | VSCode cannot debug breakpoints when using `server.ssrLoadModule`      | Original issue reporting the problem. Suggested `vite://` namespace for `sourceURL`. Closed as duplicate.                                                                                        |
| [#13503](https://github.com/vitejs/vite/issues/13503) | Breakpoints lost in JS files with HRM                                  | Related bug about HMR and breakpoints                                                                                                                                                            |
| [#13514](https://github.com/vitejs/vite/pull/13514)   | fix: breakpoints in JS not working                                     | **The merged fix.** Adds identity source maps to SSR modules via MagicString `hires:'boundary'`. Initially tried `sourceURL` approach but "doesn't work with VSCode's debugger". Now in Vite 5+. |
| [#14247](https://github.com/vitejs/vite/pull/14247)   | fix: use relative path for sources field                               | Made `sources` fields relative (opposite direction of fix #2).                                                                                                                                   |
| [#22148](https://github.com/vitejs/vite/pull/22148)   | fix: skip fallback sourcemap generation for `?raw` imports             | Recent fix to the identity source map generation to skip certain imports.                                                                                                                        |
| [#13971](https://github.com/vitejs/vite/pull/13971)   | perf: use magic-string hires boundary for sourcemaps                   | Performance improvement for identity source maps.                                                                                                                                                |
| [#7767](https://github.com/vitejs/vite/issues/7767)   | Missing/broken sourcemaps for JS modules w/ imports when used with Vue | Related source map chaining issue                                                                                                                                                                |
| [#8081](https://github.com/vitejs/vite/issues/8081)   | Cannot change SourceMaps path if esbuild is not used                   | Related to source path resolution                                                                                                                                                                |

---

## Experimental Findings

### Test 1: Plain Vite SSR (No Babel Plugin)

When testing Vite 7.3.5 without any Cedar Babel plugin:

```
Script URL: /Users/.../typescript.ts
sourceMapURL present: true
SSR sourceMap sources: ['typescript.ts']
SSR sourceMap sourcesContent: present (matches original file)
SSR sourceMap file: file:///Users/.../typescript.ts

Debugger.setBreakpointByUrl with file:///URL → 0 locations (pending, never hits)
Debugger.setBreakpointByUrl with bare path URL → 1 location (matched!)
```

The identity source map fix works for bare path URLs but not for `file://` URLs.

### Test 2: With Cedar Babel `enforce:'pre'` Plugin

```
Original file:  const x: number = 0;
Babel output:   const x = 0;

Babel sourceMap sourcesContent: original file (correct)
Babel sourceMap sources: ['typescript.ts']

SSR output sourceMap sourcesContent: original file (same as Babel)
SSR output sourceMap sources: ['typescript.ts']
```

The source map chain (`combineSourcemaps` via `@ampproject/remapping`) correctly
propagates `sourcesContent` from the Babel map to the final combined map. The
`sourcesContent = [originalCode]` line in `ssrTransformScript` is just a
fallback — `remapping` overrides it with the correct content from the innermost
map (`inMap`). **The source map chain is correct.**

### Test 3: Source Map Chain Test (SSR Transform)

The test in `packages/vite/src/__tests__/sourcemaps.test.ts` uses
`ssrTransform()` directly with `@jridgewell/trace-mapping`:

```typescript
const ssrResult = await ssrTransform(
  babelResult.code,
  babelResult.map,
  '/api/src/functions/graphql.ts',
  simpleHandlerInput
)
const tracer = new TraceMap(ssrResult.map)
assertMapsToSource(codeLines, tracer, 'createGraphQLHandler', 2) // import metadata
assertMapsToSource(codeLines, tracer, 'createGraphQLHandler)({', 4) // handler call
```

This test verifies that the combined source map (SSR + Babel) correctly maps
positions back to the original source. Both assertions pass, confirming that
`remapping` correctly chains the source maps for the test cases.

### CDP Breakpoint Hit Test

In `tasks/dev-debug-tests/debugger-sourcemaps.test.mts`:

1. Spawn `cedar dev --ud --debugBrk`
2. Connect via CDP WebSocket
3. Wait for `Debugger.scriptParsed` with URL matching `hello.ts` (bare path)
4. Set `Debugger.setBreakpointByUrl` with `url: helloPath` (also bare path)
5. Make HTTP request to trigger the handler
6. Wait for `Debugger.paused`

This test passes — breakpoints hit at the correct line when both the script URL
and breakpoint URL use bare paths. This confirms the source map chain is correct
for basic cases.

### Test 4: file:// SourceURL Validation

To verify that changing the `//# sourceURL=` to `file://` format actually fixes
breakpoint binding, the `inlineSourceMap` function in Vite's bundled code was
temporarily patched:

```javascript
// Before (Vite upstream):
//# sourceURL=${mod.id}

// After:
//# sourceURL=file://${mod.id}
```

A standalone Vite SSR test loaded a module with an exported async function and
set pending `Debugger.setBreakpointByUrl` breakpoints with `file://` URLs:

```
Pending BP: breakpointId="1:1:0:file:///private/var/.../handler.ts"
Script URL from scriptParsed: file:///private/var/.../handler.ts
Paused events: 1  ← breakpoint hit!
```

**Result: The `file://` sourceURL patch works.** The pending breakpoint resolved
against the matching script URL and fired when the handler function was called.

**Gotcha:** On macOS, `/var` is a symlink to `/private/var`. If the breakpoint
URL uses the symlinked path (`/var/...`) but Vite's module graph resolves to the
real path (`/private/var/...`), the URLs don't match. Using `fs.realpathSync()`
on the file path before constructing the breakpoint URL resolves this.
**Where the sourceURL is set:** The `//# sourceURL=` is added by Vite's
`inlineSourceMap` function at line 34093 of
`node_modules/vite/dist/node/chunks/config.js`. It is NOT accessible
from Vite's plugin pipeline (`transform` hooks run before
`inlineSourceMap`), so a Vite plugin cannot patch it. The fix must be
applied either by:

1. Patching `inlineSourceMap` directly (requires modifying Vite's bundle)
2. A Node.js `--require` hook or ESM loader that intercepts the SSR
   module evaluation and rewrites the sourceURL after `inlineSourceMap`
3. Forking Vite or contributing the change upstream

### Test 5: CDP Proxy (Real Debug Adapter Traffic)

A WebSocket proxy was placed between the editor's debug adapter
(`vscode-js-debug`) and Node.js's inspector to capture the actual CDP
traffic when setting breakpoints on a Vite SSR API function.

**Setup:**

1. Run `cedar dev --ud --debugBrk` (inspector on port 18911)
2. Proxy listens on port 18912, forwards to 18911
3. Editor attaches to proxy port 18912
4. Breakpoints set on API function source file
5. HTTP request triggers the handler

**Proxy output (key lines):**

```
>>> REQUEST: Debugger.setBreakpointByUrl       ← urlRegex sent
<<< BP id=2:0:0:file:///... locs=1            ← matched 1 location!
<<< BP id=2:26:0:file:///... locs=1           ← matched 1 location!
>>> REQUEST: Debugger.setBreakpoint            ← scriptId fallback
*** BY SCRIPT ID *** scriptId: 2335 line: 11
<<< BP id=4:11:0:2335 locs=0
<<< PAUSED line=11 url=(none) reason=other     ← breakpoint fired
<<< PAUSED line=12 url=(none) reason=step      ← step works
<<< PAUSED line=13 url=(none) reason=step
...
```

**Key findings:**

1. The debug adapter sends **both** `setBreakpointByUrl` (with `urlRegex`)
   and `setBreakpoint` (by `scriptId`) for each breakpoint.
2. **The `urlRegex` approach works.** V8 matched `locs=1` for the
   breakpoint, confirming the URL format is not the issue.
3. Breakpoints **fire correctly** and stepping works at the right lines.
4. **No line offset issues observed** — the breakpoints hit at the
   expected source locations.
5. Call frame URL is empty (`url=none`) in paused events, but this does
   not affect breakpoint functionality.

**Conclusion:** The URL format mismatch theory is incorrect. The debug
adapter's `urlRegex` matches bare path script URLs without issue.
Breakpoints bind, fire, and resolve to correct source locations.

---

## Root Cause

The original investigation was based on the theory that a URL format mismatch
between `//# sourceURL=` (bare path) and the editor's breakpoint request
(`file://` URL) prevented breakpoints from binding. **This theory is incorrect.**

A CDP proxy test (Test 5) confirmed that:

1. The debug adapter (`vscode-js-debug`) sends `urlRegex` (not exact `url`),
   which matches both `file://` and bare paths.
2. V8 successfully matches `urlRegex` breakpoints against Vite SSR scripts.
3. Breakpoints bind, fire, and resolve to correct source locations.
4. No line offset or binding issues were observed.

The source map chain (Babel `enforce:'pre'` → SSR transform) is correct.
The `hasSourceURL` flag causes a `setBreakpointByScriptId` fallback, but this
also works and does not prevent breakpoint functionality.

**No root cause was found.** Breakpoints in `cedar dev --ud` work correctly
with the current implementation. This includes both the attach workflow
(attaching to the inspector port via the editor's "attach by port" feature)
and the `--debugBrk` workflow (which pauses at startup and waits for the
debugger before loading API functions). The earlier reported issues may
have been resolved by changes on the investigation branch, or may have been
specific to certain project configurations not reproduced during testing.

## Candidate Fix Approaches

**None needed.** Breakpoints work correctly with the current implementation.
The candidate fixes below were investigated during the root cause search but
are not required.

### A. Fix the `sourceURL` Format (Not Needed)

Change `inlineSourceMap` to emit `file:///` URLs — validated to work in raw
CDP tests, but unnecessary because the debug adapter uses `urlRegex` which
matches both formats.
graph or the evaluation pipeline. This approach:

- Only affects Cedar's dev server (no wider Vite impact)
- Survives yarn upgrades (hook loads the installed Vite version)
- Can use `pathToFileURL()` for correct cross-platform file URL generation
- Still needs to handle the `/var` vs `/private/var` realpath issue

**Risk:** Monkey-patching Vite internals is fragile across Vite versions. The
hook would need to be updated when Vite changes its internal module structure.

**Alternative:** Use Node.js's `--experimental-loader` API to create an ESM
loader that transforms the evaluated code and rewrites `sourceURL` before V8
parses it.

### D. Rely on Editor `sourceMapPathOverrides`

Document that users need to configure their editor's launch config:

```json
{
  "type": "node",
  "sourceMapPathOverrides": {
    "/Users/*": "${workspaceFolder}/*"
  }
}
```

This tells `vscode-js-debug` how to match bare paths to workspace paths.

**Upstream mapping:** Standard debug adapter configuration — not a Vite issue.

**Risk:** Requires user configuration, not automatic. Doesn't fix the
fundamental issue.

---

## Open Questions

1. **Why is the call frame URL empty (`url=none`) in paused events?**
   This may be related to `hasSourceURL = true` or the `new AsyncFunction()`
   evaluation. It doesn't prevent breakpoints from working, but could
   affect source map resolution in some scenarios.

2. **Does the `hasSourceURL` → `setBreakpointByScriptId` fallback cause
   breakpoint loss on HMR?** If the debug adapter sets breakpoints by
   script ID, and HMR reloads the module with a new script ID, the
   breakpoint would be lost. The `urlRegex` breakpoint should survive
   reload, but only if the debug adapter retries it after HMR.

3. **Can we remove the `//# sourceURL=` comment entirely?** The identity
   source map already provides `sourcesContent` for source display, so the
   `sourceURL` may be redundant. Removing it would set `hasSourceURL = false`,
   letting the debug adapter use URL-based breakpoints throughout.

---

## How to Reproduce

### Prerequisites

- Cedar repo checked out
- `yarn install` completed
- Node.js 24+

### Test 1: Source Map Chain (Unit Test)

```bash
cd packages/vite
yarn vitest run __tests__/sourcemaps.test.ts
```

### Test 2: E2E Breakpoint Test (CDP)

```bash
cd tasks/dev-debug-tests
yarn vitest run debugger-sourcemaps.test.mts
```

### Test 3: Manual Debugging (VS Code / Zed)

Both editors use the same `vscode-js-debug` adapter and accept the same launch
configuration format.

```bash
cedar dev --ud --debugBrk
```

Then attach the editor debugger. Configuration goes in `.vscode/launch.json` (VS
Code) or `.zed/debug.json` (Zed):

```json
[
  {
    "type": "node",
    "request": "attach",
    "name": "Attach to Cedar Dev",
    "port": 13306,
    "sourceMapPathOverrides": {
      "*": "${workspaceFolder}/*"
    }
  }
]
```

### Test 4: file:// SourceURL Validation (Standalone)

A quick test that patches Vite's `inlineSourceMap` to emit `file://` URLs and
verifies breakpoint binding:

```bash
# Patch Vite (one line change in node_modules):
# node_modules/vite/dist/node/chunks/config.js:34093
# Change: //# sourceURL=${mod.id}
# To:     //# sourceURL=file://${mod.id}

# Run standalone test:
node --experimental-vm-modules \
  -e "
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import inspector from 'node:inspector'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ... (see full script in the investigation notes)
"
```
