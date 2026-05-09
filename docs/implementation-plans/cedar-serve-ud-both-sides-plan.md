# Plan: `cedar serve --ud` — Serve Both Web and API Sides

**Date:** 2026-05-08  
**Status:** Draft  
**Relates to:** Universal Deploy integration plan (Phases 3–6), Phase 6 Addendum

---

## Problem Statement

Today, `cedar serve --ud` does not exist. The `--ud` flag is only wired to the
`cedar serve api` sub-command. Running `cedar serve` (no side specified, the
"both" case) always uses the legacy Fastify pair: a web Fastify server on
`webPort` that proxies API calls to a separate API Fastify server on `apiPort`.

The goal is to support `cedar serve --ud` (no side qualifier) for
**local production-like testing** — i.e. verifying a `cedar build --ud` output
behaves correctly before deploying.

---

## Command Roles

It is worth being explicit about what each command is for:

| Command                | Purpose                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `cedar serve api --ud` | **Production.** Runs `api/dist/ud/index.js` (srvx). Nginx, or some other reverse proxy, serves web assets separately.       |
| `cedar serve --ud`     | **Local production-like testing.** Runs the UD API entry + a web static file server so the full app is usable in a browser. |
| `cedar serve` (both)   | **Legacy.** Fastify web (with proxy) + Fastify API. Unchanged.                                                              |

In real baremetal/VPS production the topology is:

- **nginx** serves `web/dist/` static files directly
- **nginx** proxies API routes to a Node process (`api/dist/ud/index.js`)

`cedar serve --ud` mirrors this as closely as possible locally:

- **Fastify web server** (existing `redwoodFastifyWeb`) serves `web/dist/`
  and proxies API requests to the UD API process. Fastify is basically standing
  in for nginx
- **Forked `api/dist/ud/index.js`** handles all API routes via srvx

No changes to the Vite plugin or the build pipeline are needed.

---

## Current State

| Command                | What happens today                                 |
| ---------------------- | -------------------------------------------------- |
| `cedar serve api`      | Fastify API server                                 |
| `cedar serve api --ud` | Forks `api/dist/ud/index.js` (srvx)                |
| `cedar serve web`      | Fastify web server (`@cedarjs/web-server`)         |
| `cedar serve` (both)   | Fastify web (with proxy) + Fastify API             |
| `cedar serve --ud`     | Not recognised / falls through to "both" (Fastify) |

---

## Implementation Plan

### Step 1 — Add `--ud` to the `$0` (both) sub-command

**Files changed:**

- `packages/cli/src/commands/serve.ts`

**What to do:**

1. Add `--ud` to the `$0` yargs sub-command's `builder`, mirroring the `api`
   sub-command:

   ```ts
   yargs.option('ud', {
     description:
       'Use the Universal Deploy server for the API side. The web side is ' +
       'is served by the existing static file server. Pass --ud to opt in; ' +
       'the default is Fastify for both sides.',
     type: 'boolean',
     default: false,
   })
   ```

2. In the `$0` handler, when `argv.ud` is `true`:

   a. **Validate build artifacts** — both must exist before starting:
   - `api/dist/ud/index.js` — if missing, print a clear error pointing to
     `yarn cedar build --ud` and exit.
   - `web/dist/index.html` — if missing, print a clear error pointing to
     `yarn cedar build` and exit.

   b. **Resolve ports** — use the same helpers as the existing both-handler:
   - Web: `getWebHost()` / `getWebPort()` (default `8910`)
   - API: `getAPIHost()` / `getAPIPort()` (default `8911`)

   c. **Start the Fastify web server** with `apiProxyTarget` pointing at the UD
   API port — exactly as the existing `bothCLIConfigHandler` does, just
   substituting the forked UD entry for the Fastify API server.

   d. **Fork `api/dist/ud/index.js`** — same pattern as `cedar serve api --ud`,
   passing `--port` / `--host` for the API port/host.

   e. **Print both addresses** once both are up.

3. When `argv.ud` is `false`, the existing Fastify-pair behaviour is completely
   unchanged.

---

### Step 2 — Update the build-artifact middleware check

The existing `serve.ts` middleware already validates that the relevant dist
directories exist before any sub-command handler runs. Extend it so that when
`--ud` is present in the default (both) case, it also checks for
`api/dist/ud/index.js` and emits a helpful error pointing to
`yarn cedar build --ud` rather than the generic `yarn cedar build`.

---

### Step 3 — Update error messages

The build-not-found error in the `--ud` path (both Step 1 and the existing
`api --ud` handler) should mention `yarn cedar build --ud` explicitly, not just
`yarn cedar build api`, so users understand a plain build is not sufficient.

---

## Affected Files Summary

File: `packages/cli/src/commands/serve.ts`

Change: Add `--ud` to `$0` builder; add UD both-sides handler in `$0` handler;
update middleware check; update error messages

That is the only file that needs to change.

---

## Sequencing

All three steps are in the same file and can land in one PR.

---

## What This Approach Does NOT Include

- **`virtual:cedar-web` / web fallback inside the UD build artifact** — not
  needed here. That would only be relevant for single-runtime deployments (e.g.
  a single Cloudflare Worker serving both web and API). For the baremetal/nginx
  production topology that `cedar serve --ud` is modelling, web assets are
  always served by a separate process.
- **Changes to `cedarUniversalDeployPlugin` or `buildUDApiServer`** — the
  build pipeline is unchanged.
- **Single-port serving** — two ports (web on `8910`, API on `8911`) is
  correct here because it mirrors the two-process nginx topology.

---

## Questions/Answers

1. **`server.ts` / custom Fastify compatibility**: When `--ud` is passed,
   should Cedar warn if the project has a custom `api/src/server.ts`? That
   file is a Fastify concept and is silently ignored by the UD entry. A
   warning here would be better than a silent skip.

   Answer: Yes, Cedar should warn if the project has a custom
   `api/src/server.ts`. It should acknowledge that the user is testing the
   experimental UD support and that it won't match their production Fastify
   setup.

2. **Port flags**: The `$0` sub-command currently accepts `--port` (single
   port for... something). For the `--ud` path, there are two ports. Should
   `--port` set the web port, the API port, or be disallowed in favour of
   `--web-port` / `--api-port`? The existing `bothCLIConfig` already has
   `--webPort` and `--apiPort` options, so those should be used.

   Answer: For `yarn cedar serve --ud`, the `--port` flag should be disallowed.

---

## Exit Criteria

- `yarn cedar build --ud && yarn cedar serve --ud` starts two processes:
  the web server on `8910` and the backend on `8911`.
- The web server proxies API requests to the UD API entry.
- `GET /` (and all SPA routes) returns `web/dist/index.html`.
- `GET /.api/functions/graphql` is proxied to the UD API entry and handled by
  Yoga.
- `GET /.api/functions/myFunction` is proxied to the UD API entry and handled by
  the function handler.
- Without `--ud`, all existing `cedar serve` behavior is unchanged.
- `cedar serve --ud` with a missing `api/dist/ud/index.js` prints a clear error
  pointing to `yarn cedar build --ud`.
