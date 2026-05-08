# Plan: `cedar serve --ud` — Serve Both Web and API from a Single Process

**Date:** 2026-05-08  
**Status:** Draft  
**Relates to:** Universal Deploy integration plan (Phases 3–6), Phase 6 Addendum

---

## Problem Statement

Today, `cedar serve --ud` does not exist. The `--ud` flag is only wired to the
`cedar serve api` sub-command. Running `cedar serve` (no side specified, the
"both" case) always uses the legacy Fastify pair: a web Fastify server on
`webPort` that proxies API calls to a separate API Fastify server on `apiPort`.

The goal is to support `cedar serve --ud` (no side qualifier) such that:

1. The API side is served by the Universal Deploy / srvx entry at
   `api/dist/ud/index.js` (already produced by `cedar build --ud`).
2. The web side is served by `sirv` (or equivalent) from `web/dist/`, on the
   **same port** as the API, so no proxy hop is needed.
3. Everything is done without Fastify.

---

## Current State

| Command                | What happens today                                 |
| ---------------------- | -------------------------------------------------- |
| `cedar serve api`      | Fastify API server                                 |
| `cedar serve api --ud` | Forks `api/dist/ud/index.js` (srvx)                |
| `cedar serve web`      | Fastify web server (`@cedarjs/web-server`)         |
| `cedar serve` (both)   | Fastify web (with proxy) + Fastify API             |
| `cedar serve --ud`     | Not recognised / falls through to "both" (Fastify) |

The UD build path (`cedar build --ud`) already emits `api/dist/ud/index.js`
— a self-contained srvx server. The `cedarUniversalDeployPlugin` already
registers all API routes with `@universal-deploy/store`. What is missing:

- Web static file serving inside the UD entry (currently the entry only handles
  API routes).
- A "both" UD handler in the CLI `serve.ts` command.

---

## Approach

There are two viable approaches:

### Option A — Re-add the `virtual:cedar-web` fallback entry into the UD build

The Phase 6 Addendum already specifies precisely how to do this.
`cedarUniversalDeployPlugin` generates a `virtual:cedar-web` module that
serves `web/dist/index.html` (and ideally static assets) for unmatched
`GET` requests. Everything is bundled into `api/dist/ud/index.js`. One port.

**Pros:**

- Single output artifact. `cedar serve --ud` simply forks `api/dist/ud/index.js`.
- Consistent with the intended long-term architecture (single-port UD node
  server for self-hosting).
- `@universal-deploy/node` drives the HTTP server; Cedar registers the routes.

**Cons:**

- Serving an entire `web/dist/` static tree from inside a virtual module is
  more involved than simply pointing `sirv` at a directory.
- The `virtual:cedar-web` module needs to be a proper `sirv`/`serve-static`
  based handler, not just an `index.html` read.
- Requires touching `cedarUniversalDeployPlugin`, `buildUDApiServer`, and
  `cedar build --ud`.

### Option B — Fork two processes from the CLI (short-term)

`cedar serve --ud` forks `api/dist/ud/index.js` for the API and starts a
Fastify/sirv web server for the web side, each on their own port, just
like the existing "both" handler but using the UD entry for API.

**Pros:**

- Much smaller diff. The CLI handler just needs to launch both.
- No changes to the Vite plugin or the build pipeline.

**Cons:**

- Still two ports and a proxy (or CORS config). Not the single-port story
  the UD integration aims for.
- Doesn't deliver the "serve both from one runtime" benefit.

### Recommendation

**Option A** for the complete solution. **Option B** may be useful as a
stepping-stone to unblock users who want `--ud` serving without waiting for
the web-fallback work. The plan below describes Option A in full, with a
note on how Option B can be landed first.

---

## Implementation Plan

### Step 1 — Optional stepping-stone: `cedar serve --ud` with two processes (Option B)

This can be done immediately and independently of the build pipeline changes.

**Files changed:**

- `packages/cli/src/commands/serve.ts`

**What to do:**

1. Add `--ud` to the `$0` (default/both) yargs sub-command's `builder`,
   mirroring the `api` sub-command:

   ```
   yargs.option('ud', {
     description: 'Use the Universal Deploy server (srvx) for the API. Pass --ud to opt in.',
     type: 'boolean',
     default: false,
   })
   ```

2. In the `$0` handler, when `argv.ud` is `true`:
   - Validate that `api/dist/ud/index.js` exists (same check as `serve api --ud`).
   - Validate that `web/dist/index.html` exists (same as existing web check).
   - Fork `api/dist/ud/index.js` as the API process.
   - Start the existing web Fastify/sirv server for the web side.
   - Print both addresses.

3. Add an **exit criterion check** to the middleware for the `--ud` path:
   `api/dist/ud/index.js` must exist, otherwise emit a clear error
   pointing to `yarn cedar build --ud`.

**Acceptance criteria for Step 1:**

- `cedar serve --ud` starts the srvx API entry and the web Fastify server.
- Without `--ud`, existing behaviour is unchanged.

---

### Step 2 — Re-enable `virtual:cedar-web` in `cedarUniversalDeployPlugin`

The Phase 6 Addendum documents the full re-implementation. This step makes
it actually reachable.

**Files changed:**

- `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`
- `packages/vite/src/buildUDApiServer.ts`

#### 2a — Add `webFallback?: boolean` option back to the plugin

In `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`:

1. Add `webFallback?: boolean` to `CedarUniversalDeployPluginOptions`.

2. When `webFallback` is `true`, in the `config` hook, register a web
   fallback entry **after** all API entries:

   ```ts
   addEntry({
     id: 'virtual:cedar-web',
     route: '/**',
     method: 'GET' as EntryMeta['method'],
   })
   ```

   The route `/**` must come last so it acts as a catch-all only when no
   API route matched. Verify that `@universal-deploy/store` / `rou3` orders
   entries by specificity; if not, position in registration order matters.

3. In `resolveId`, handle `'virtual:cedar-web'` → `'\0virtual:cedar-web'`.

4. In `load`, handle `'\0virtual:cedar-web'` and generate the module
   (see §2b below).

#### 2b — Generate the web fallback virtual module

The generated module must serve:

- **Static files** from `web/dist/` (CSS, JS, fonts, images, etc.)
- **SPA fallback** — serve `web/dist/index.html` for any `GET` that does
  not match a static file.

Use `sirv` (already a dependency of `@universal-deploy/node`) for this.

Generated module shape:

```ts
// virtual:cedar-web (generated by cedarUniversalDeployPlugin)
import { createReadableStream } from 'node:fs'
import sirv from 'sirv'
import { promisify } from 'node:util'

const serve = sirv(<webDistPath>, { single: true, dev: false })

export default {
  async fetch(request) {
    // Wrap sirv (Node http handler) into a fetch-compatible handler.
    // See §2c below for the adapter helper.
    return nodeHandlerToFetch(serve, request)
  }
}
```

The `nodeHandlerToFetch` helper converts a Node.js `(req, res)` handler to
a `fetch`-native `(Request) => Response`. See §2c.

**Important:** `sirv` with `single: true` handles the SPA fallback
(`index.html` for unknown paths) natively.

**Alternatively**, if `sirv` integration proves complex inside a Vite virtual
module, the module can directly read `index.html` for all requests and serve
static assets from the file system using the Web `File` API or `ReadableStream`
from Node. This is simpler but gives up the efficient static asset caching and
range-request handling that `sirv` provides.

A simple but correct fallback:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

const WEB_DIST = <webDistPath>function guessContentType(filePath) {
  // minimal mime type map for the most common web assets
  const ext = path.extname(filePath).toLowerCase()
  const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.json': 'application/json',
  }
  return types[ext] ?? 'application/octet-stream'
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const filePath = path.join(WEB_DIST, url.pathname)

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const body = Readable.toWeb(fs.createReadStream(filePath))
      return new Response(body, {
        headers: { 'Content-Type': guessContentType(filePath) },
      })
    }

    // SPA fallback
    const indexPath = path.join(WEB_DIST, 'index.html')
    const body = Readable.toWeb(fs.createReadStream(indexPath))
    return new Response(body, {
      headers: { 'Content-Type': 'text/html' },
    })
  },
}
```

This approach is self-contained and has no extra runtime dependency.

#### 2c — (If using sirv) Node handler → Fetch adapter

Since `@universal-deploy/node` uses `srvx` under the hood, which can
call `.fetch(request)` directly, a thin adapter is needed to bridge
sirv's Node `(req, res)` API into `fetch`-native `(Request) => Response`.

This adapter is a utility function; it can live in
`packages/vite/src/ud-handlers/node-handler-to-fetch.ts` or be inlined
in the generated virtual module.

Rough shape (Node-only):

```ts
import { IncomingMessage, ServerResponse } from 'node:http'

export async function nodeHandlerToFetch(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  request: Request
): Promise<Response> {
  // Build a minimal IncomingMessage from the fetch Request
  // Build a writable ServerResponse that captures the response body/headers
  // Resolve the Promise when res.end() is called
}
```

Note: this is only needed for the sirv path. The simple file-read fallback
(§2b alternative) does not require this adapter.

---

### Step 3 — Thread `webFallback: true` through `buildUDApiServer`

In `packages/vite/src/buildUDApiServer.ts`:

1. Add `webFallback?: boolean` to `BuildUDApiServerOptions`.

2. Pass it to `cedarUniversalDeployPlugin({ apiRootPath, webFallback })`.

---

### Step 4 — Wire `--ud` serve-both through the CLI

**Files changed:**

- `packages/cli/src/commands/serve.ts`

Update the `$0` handler to, when `argv.ud` is `true`:

1. **Check build artifacts:**
   - `api/dist/ud/index.js` exists.
   - `web/dist/index.html` exists.
   - If either is missing, print a clear error pointing to `yarn cedar build --ud`.

2. **Fork `api/dist/ud/index.js`** — it now serves both API routes and the
   web SPA fallback, all on one port. No web server process needed.

3. **Single port** — the UD entry starts an srvx server bound to `PORT` (or
   the `--port` flag value). Print the address once.

When `argv.ud` is `false`, the existing Fastify-pair behaviour is unchanged.

---

### Step 5 — Wire `webFallback: true` into `cedar build --ud`

**Files changed:**

- `packages/cli/src/commands/build/index.ts` (or wherever `buildUDApiServer` is called)

When the build task runs `buildUDApiServer()`, pass `webFallback: true` so
the emitted `api/dist/ud/index.js` includes the web static file handler.

---

### Step 6 — Update error messages and documentation

Update the build-not-found error in `serve.ts` (both the `$0` and `api`
handlers) to mention `yarn cedar build --ud` rather than the generic
`yarn cedar build api`.

Update `cedar.toml` docs / CLI help text to explain that `--ud` on serve
requires a `--ud` build.

---

## Affected Files Summary

| File                                                              | Change                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/serve.ts`                              | Add `--ud` to `$0` builder; add UD both-sides handler in `$0` handler                  |
| `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts` | Re-add `webFallback` option; register `virtual:cedar-web`; `resolveId` + `load` for it |
| `packages/vite/src/buildUDApiServer.ts`                           | Add `webFallback` option; forward to plugin                                            |
| `packages/cli/src/commands/build/index.ts`                        | Pass `webFallback: true` when building with `--ud`                                     |
| `packages/vite/src/ud-handlers/`                                  | (optional) `node-handler-to-fetch.ts` if sirv path is taken                            |

---

## Sequencing

```
Step 1 (Option B stepping-stone)
  └── can land immediately; unblocks users on --ud serving

Step 2 + Step 3 (re-add virtual:cedar-web)
  └── depends only on: Step 1 (or independent of it for build pipeline)

Step 4 (CLI --ud both handler update)
  └── depends on: Step 2 + Step 3 (build artifact now serves web too)

Step 5 (build passes webFallback: true)
  └── depends on: Step 3

Step 6 (messages + docs)
  └── depends on: Step 4 + Step 5
```

---

## Open Questions

1. **`sirv` vs. simple file-read**: Does the web static serving need
   cache headers, range requests, and etag support (sirv gives these for
   free), or is a simple file-read adequate for the initial implementation?
   The simple approach is significantly easier to implement inside a Vite
   virtual module.

2. **Port exposure**: When `cedar serve --ud` serves both web and API on one
   port, should `--port` default to `8910` (the current web port) or `8911`
   (the current API port)? Or should it default to a new value (e.g. `8910`
   for parity with dev)?

3. **Prerendered HTML files**: For apps using `cedar prerender`, individual
   prerendered HTML files live in `web/dist/` at their route paths. Does the
   web fallback virtual module need to prefer prerendered HTML files over
   `index.html` when the path matches exactly? `sirv` with `single: true`
   handles this correctly. The simple file-read approach handles it too
   (static file check before SPA fallback).

4. **`apiRootPath` stripping in the catch-all**: The UD dispatcher in
   `generateCatchAllModule` already strips `apiRootPath` before matching.
   The web fallback is registered as `/**` after all API entries. Confirm
   that the rou3 router respects specificity ordering and will not route
   `GET /graphql` to the web fallback.

5. **`server.ts` / custom Fastify compatibility**: When `--ud` is passed to
   `cedar serve`, should Cedar validate that the project does not have a
   custom `api/src/server.ts`? The custom server file is a Fastify concept
   and is silently ignored by the UD entry. This should produce a warning,
   not a silent skip.

---

## Exit Criteria

- `yarn cedar build --ud && yarn cedar serve --ud` starts a single process
  on a single port that serves both API requests and the web SPA.
- `GET /graphql` is handled by the GraphQL Yoga handler.
- `GET /api/myFunction` (or whatever the API root path is) is handled by
  the function handler.
- `GET /` returns `web/dist/index.html`.
- `GET /some/spa/route` (no matching file) returns `web/dist/index.html`
  (SPA fallback).
- `GET /assets/main.abc123.js` returns the correct JS file from
  `web/dist/assets/`.
- Without `--ud`, all existing `cedar serve` behaviour is unchanged.
- `cedar serve --ud` with a missing `api/dist/ud/index.js` prints a clear
  error pointing to `yarn cedar build --ud`.
