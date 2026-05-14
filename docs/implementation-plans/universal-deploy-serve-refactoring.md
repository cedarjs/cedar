# Refactoring: Adapter-Agnostic UD Build + Adapter-Free Local Serve

## Status

Draft for implementation review.

## Summary

Split the Universal Deploy (UD) API build artifact from the local HTTP server.
After this refactor:

- `cedar build --ud` produces a pure WinterTC-compatible API artifact at
  `api/dist/ud/index.js`
- `cedar serve api --ud` imports that artifact and hosts it via srvx
- `cedar serve --ud` imports that same artifact and runs a production-like
  two-port topology for local testing
- provider-specific Vite plugins in the user's config may emit their own deploy
  artifacts, but they do not change Cedar's canonical local UD artifact

The key change is architectural: **build produces a Fetchable, serve wraps the
Fetchable**.

## Motivation

Today the UD flow mixes two concerns:

1. generating the API artifact Cedar wants to test and deploy
2. deciding how that artifact is hosted in Node for local/prod usage

That creates several problems:

- **Config duality**: one Vite config cannot cleanly support both local testing
  and deployment adapters when the build output itself changes shape based on
  adapter auto-detection.
- **Runtime lock-in**: the built API output is tied to a Node startup wrapper
  instead of being a portable Fetch-compatible module.
- **Serve/build coupling**: changing the local server implementation should not
  require changing the build artifact.
- **Provider ambiguity**: Cedar needs one canonical artifact it can always serve
  locally, even when the user's Vite config also contains Netlify, Vercel, or
  other provider plugins.

## Goals

- Make `cedar build --ud` always emit Cedar's canonical API artifact in a
  provider-independent format.
- Make `cedar serve --ud` and `cedar serve api --ud` host that artifact without
  requiring the artifact itself to boot an HTTP server.
- Preserve the current `cedar dev --ud` model, which is already Vite-driven.
- Allow user Vite configs to include deployment plugins without breaking local
  `cedar build --ud` + `cedar serve --ud` workflows.
- Keep `cedar serve --ud` production-like for VPS/baremetal/Docker by using a
  separate web port and API port.

## Non-Goals

- Merging the existing Cedar build pipeline into a single Vite build step in
  this refactor.
- Designing the long-term pluggable HTTP server API beyond the minimum seam
  needed for this refactor.
- Changing `cedar dev --ud` behavior.
- Solving non-Node runtime hosting in this change. This refactor makes that
  possible later, but the implementation target here is still local Node serve.
- Reworking the older `cedar-serve-ud-both-sides-plan.md` document yet.

## Guiding principle

### Build produces Fetchable, serve wraps Fetchable

The canonical Cedar UD API output should be a module whose default export is a
WinterTC-compatible Fetchable. It should not start listening on a port. It
should not embed srvx or any other HTTP server. It should not auto-select a
provider adapter.

`cedar serve --ud` is responsible for hosting the built Fetchable locally.

## Decisions locked for this refactor

### 1. Cedar owns `cedarUniversalDeployPlugin()` injection

Cedar should continue to inject `cedarUniversalDeployPlugin()` itself during the
UD build. Users should **not** be required to remember to add a Cedar-internal
plugin to their Vite config.

User config is still loaded so provider plugins can run, but the canonical Cedar
UD artifact remains Cedar-owned.

### 2. Canonical output stays `api/dist/ud/index.js`

Use the lowest-friction output shape that matches the current implementation.
`resolveUDEntryPath()` may continue to tolerate both `.js` and `.mjs`, but the
canonical emitted filename remains `index.js`.

### 3. UD `apiRootPath` is part of the build contract

Silent remapping is not acceptable.

In UD mode, the effective API prefix is baked into the generated artifact.
`cedar serve --ud` should host the artifact as-built, not reinterpret route
prefixes at runtime.

Preferred UX for this refactor:

- support `--apiRootPath` for `cedar build --ud`
- do **not** support it for `cedar serve --ud` unless implementation reality
  makes that too awkward
- if serve-time support is needed as a fallback, it should only be used to
  match/validate the built prefix, never to remap it

### 4. `cedar serve --ud` remains two-port

For local production-like testing, `cedar serve --ud` should continue to model a
split topology:

- web server on the web port
- API server on the API port
- web server proxies API requests to the API server

The artifact is still pure Fetchable; the topology remains split because that is
closer to likely VPS/baremetal/Docker production setups.

### 5. srvx is the local UD host for now

Use srvx as the Node host for the imported Fetchable. Alternative hosts such as
Fastify can be added later as follow-up work.

### 6. User Vite config must participate in UD builds

`buildUDApiServer()` should load the user's Vite config so deployment plugins
can run during `cedar build --ud`.

## Current state

From the current code:

- `packages/vite/src/buildUDApiServer.ts` already builds an adapter-free entry
  with `cedarUniversalDeployPlugin()`, `catchAll()`, and `devServer()`.
- `packages/cli/src/commands/serve.ts` still assumes the built UD entry is a
  self-starting Node server and uses `fork()` to launch it.
- `cedar serve --ud` currently uses two ports in the implementation: Fastify
  serves web on one port and proxies to a forked UD API process on another
  port.
- `cedar serve api --ud` also forks the built UD entry as a child process.

So the build side is already partly aligned, while the serve side still targets
an older self-starting-artifact model.

## Target state

### Canonical build artifact

`cedar build --ud` emits Cedar's canonical local UD artifact at:

```text
api/dist/ud/
  index.js           # default export is a pure Fetchable
  assets/            # lazily loaded route chunks, if generated by Vite/Rollup
```

Notes:

- The current implementation emits `index.js`, not `index.mjs`.
- `serve.ts` may continue to resolve either `.mjs` or `.js` defensively.
- Provider plugins may emit additional artifacts elsewhere, but Cedar's own
  local-serve contract is anchored on `api/dist/ud/index.js|mjs`.

### Local serving model

#### `cedar serve api --ud`

- dynamically imports the built Fetchable
- wraps it in srvx
- listens on the configured API host/port
- does not fork a child process

#### `cedar serve --ud`

- validates API and web build artifacts
- starts a web server on the configured web host/port
- starts an API server on the configured API host/port by importing the same UD
  Fetchable and hosting it with srvx
- proxies API requests from web → API
- preserves production-like split topology for local testing

## Why two-port serve is the right target for now

There are two plausible local-serve designs:

1. **single-port in-process host** for both web and API
2. **split web/API ports** that more closely mirror reverse-proxy production
   setups

For this refactor, the second option is the better fit because:

- it preserves the current mental model of `cedar serve`
- it more closely resembles likely VPS/baremetal/Docker production deployments
- it reduces CLI churn and routing/fallback complexity
- it still fully achieves the important architectural separation: the built UD
  artifact is no longer a self-starting server

A future single-port option is still possible later, but it is not required to
get the core artifact/serve separation right.

## Proposed implementation

### 1. Update `buildUDApiServer` to combine Cedar-owned plugins with user config

File:

- `packages/vite/src/buildUDApiServer.ts`

What the code already does correctly:

- uses `catchAll()` and `devServer()` from `@universal-deploy/vite`
- does **not** use `universalDeploy()`
- emits an SSR build to `api/dist/ud`
- registers Cedar routes through `cedarUniversalDeployPlugin()`
- emits `index.js`

What should change:

1. **Load the user's Vite config** via `configFile: rwPaths.web.viteConfig`.
2. **Keep Cedar-owned UD plugin injection**. Do not move
   `cedarUniversalDeployPlugin()` ownership into user config.
3. **Ensure the effective `apiRootPath` matches non-UD semantics.** If needed,
   thread the resolved prefix into `cedarUniversalDeployPlugin()` rather than
   relying on its default `'/'`.
4. **Preserve adapter-free output.** User deployment plugins may emit their own
   artifacts, but Cedar's canonical `api/dist/ud/index.js` must remain a pure
   Fetchable.

#### Recommended build shape

The UD build should explicitly include:

- `configFile: rwPaths.web.viteConfig`
- `logLevel`
- Cedar-controlled UD plugins required for the canonical artifact
- `build: { ssr: true, outDir, rollupOptions: { input: 'virtual:ud:catch-all', output: { entryFileNames: 'index.js' } } }`

### 2. Refactor `cedar serve api --ud` to import, not fork

File:

- `packages/cli/src/commands/serve.ts`

Current behavior:

- resolves `api/dist/ud/index.[m]js`
- `fork()`s it as a child process
- waits for the child to bind a port

Target behavior:

- dynamically import the built module in-process
- read its default export as a Fetchable
- host it with srvx
- support graceful shutdown in-process
- preserve current API host/port CLI behavior

This should be extracted into a helper so both `serve api --ud` and `serve --ud`
use the same import-and-host logic.

Suggested responsibilities for the helper:

- `resolveUDEntryPath()`
- `import()` the module via a file URL-safe path
- validate that the default export looks like a Fetchable (`fetch` function)
- start srvx on configured host/port
- expose shutdown/close handling

### 3. Refactor `cedar serve --ud` to host the Fetchable externally, but keep the split topology

File:

- `packages/cli/src/commands/serve.ts`

Current behavior:

- validates `api/dist/ud/index.js`
- validates `web/dist/index.html`
- starts Fastify web server on one port
- forks UD API process on another port
- proxies web → API

Target behavior:

- validate API and web build artifacts
- dynamically import the built Fetchable in-process
- start the API host with srvx on the configured API port
- start the existing web server on the configured web port
- keep proxying web → API
- remove child-process management for the UD API side
- support coordinated graceful shutdown of both servers

This keeps the local topology stable while still separating the artifact from
its Node host.

### 4. Keep `cedar dev --ud` unchanged

No implementation change is planned for dev. The dev story remains the Vite dev
server handling both web and API inline.

## `apiRootPath` alignment work

This is the most important semantic detail to get right before coding.

### What non-UD mode does today

From the current code, non-UD mode does **not** have a single shared
`getApiRootPath()` helper today.

Instead:

- `packages/api-server/src/apiCLIConfig.ts` and
  `packages/api-server/src/bothCLIConfig.ts` expose an `--apiRootPath` CLI flag
  with a default of `'/'`
- `packages/api-server/src/apiCLIConfigHandler.ts` and
  `packages/api-server/src/bothCLIConfigHandler.ts` normalize that flag via
  `coerceRootPath(options.apiRootPath ?? '/')`
- `packages/api-server/src/createServerHelpers.ts` also defaults
  `apiRootPath` to `'/'`, parses CLI args, and normalizes via `coerceRootPath`
- the Fastify API plugins then register routes under that normalized prefix

Separately, Cedar config has `getConfig().web.apiUrl`, whose default is
`'/.api/functions'`. That value is used on the **web/proxy side** and for web
runtime env vars. It is not the same thing as the Fastify API server's
`apiRootPath` input.

In `serve` both-sides mode today, those two pieces are connected by the CLI
handler:

- `options.apiRootPath` determines the API server route prefix
- that same `options.apiRootPath` is appended when constructing the web
  `apiProxyTarget`

So the practical non-UD source of truth for serve is:

- **CLI option if provided**
- otherwise **default `'/'`**
- then normalized with `coerceRootPath`

### Desired behavior for UD

UD mode should preserve the important invariant even if the UX differs from
non-UD mode:

- the built artifact should contain routes with the effective Cedar API prefix
- local serve should not silently remap those routes later
- mismatches between build-time and runtime API prefix expectations should not
  be papered over by proxy magic

### Preferred decision for this refactor

The preferred contract is:

- `buildUDApiServer()` resolves `apiRootPath` using build-time input, with the
  same normalization rule as non-UD mode: **CLI value if supplied, otherwise
  `'/'`, then `coerceRootPath()`**
- that resolved prefix is passed into `cedarUniversalDeployPlugin()` so the
  built UD routes are generated with the correct prefix
- `cedar serve api --ud` and `cedar serve --ud` do **not** accept
  `--apiRootPath`; they serve the built artifact at whatever prefix it was built
  for

### Fallback if implementation gets awkward

If removing `--apiRootPath` from UD serve paths turns out to be too awkward or
invasive for this refactor, a fallback is acceptable:

- keep `--apiRootPath` on UD serve commands temporarily
- but use it only for prefix matching/validation or proxy wiring
- never use it to remap an artifact built for a different prefix into working

### Consequence of this decision

Because the UD artifact bakes the route prefix into the generated router,
production-like correctness requires build-time and serve-time prefix agreement.

That means:

- `cedar build --ud --apiRootPath /foo` should produce an artifact whose routes
  live under `/foo/`
- ideally `cedar serve --ud` should infer or read that built prefix, rather than
  asking the user to repeat it
- if a temporary serve-time `--apiRootPath` escape hatch remains, then
  `cedar serve --ud --apiRootPath /bar` against an artifact built for `/foo/`
  should not be silently remapped into working

Ideally, Cedar should detect and fail clearly on that mismatch if we have an
inexpensive way to record/read the built prefix. If not, the plan should still
assume prefix parity is required and cover it in tests/docs.

### Important non-goal for now

Do **not** try to redefine UD semantics around `getConfig().web.apiUrl` in this
refactor.

That config still matters for the web side, but the current non-UD API-server
behavior is driven by `apiRootPath` CLI/server options, not by deriving the
server prefix from `web.apiUrl`.

## Routing / fallback behavior

The simplest correct behavior is:

- API-prefix paths go to the API server and preserve API responses and API 404s
- web asset requests are handled by the web server
- non-API browser route requests fall back to the SPA shell according to current
  web-serve semantics
- API misses do **not** return the SPA shell

Because `cedar serve --ud` remains two-port, this is simpler than a single-port
mixed dispatcher:

- web concerns stay on the web server
- API concerns stay on the API server
- the proxy boundary keeps the behaviors separate

## Proposed serve abstraction

For this refactor, the serve abstraction is concrete:

- **API host**: srvx hosting the imported UD Fetchable
- **web host**: existing Cedar web serving path
- **both-side UD serve**: existing split-topology arrangement, but with the API
  side hosted in-process rather than forked as a self-starting entry

Longer-term pluggability can be added later.

## Files likely affected

### Required

- `packages/cli/src/commands/serve.ts`
- `packages/vite/src/buildUDApiServer.ts`

### Possibly required

- tests for `serve.ts`
- build tests covering UD artifact shape, `configFile` loading, and
  `apiRootPath` semantics
- potentially a small new helper file under `packages/cli/src/commands/` if the
  UD host logic is extracted

### Probably not required

- `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`

That plugin already:

- discovers Cedar API routes
- registers UD store entries
- generates per-function virtual modules
- clears stale Cedar entries between build steps

The only plugin-related change I would expect is if it needs a resolved
`apiRootPath` explicitly threaded in from the same source non-UD mode uses.

## Revised test plan

### Unit / command-level tests

1. `serve api --ud` imports the built artifact instead of forking.
2. `serve --ud` starts the API side in-process instead of forking a child.
3. `serve --ud` still uses the configured split web/API topology.
4. missing `api/dist/ud/index.[m]js` prints a clear `build --ud` error.
5. missing `web/dist/index.html` prints a clear web build error for
   `serve --ud`.
6. invalid UD module shape fails with a clear message.
7. shutdown handlers close the in-process srvx server cleanly.
8. the existing warning for `api/src/server.ts` remains in the UD both-sides
   path.
9. UD serve does not silently remap an artifact built for one `apiRootPath` to
   another prefix.

### Integration tests

1. `cedar build --ud` emits a canonical Fetchable artifact at
   `api/dist/ud/index.js`.
2. `cedar serve api --ud` serves GraphQL successfully from the built artifact.
3. `cedar serve --ud` serves web and API from separate ports, with the API side
   hosted from the imported Fetchable rather than a forked process.
4. a user Vite config containing provider plugins still allows
   `cedar build --ud` + `cedar serve --ud` to work.
5. `cedar build --ud --apiRootPath /foo` produces routes under `/foo/`.
6. UD serve hosts the artifact at its built prefix without silent remapping.
7. API-prefix routes preserve API 404 behavior and do not fall through to SPA
   fallback.

## Remaining question to settle before coding

I think there is now one practical implementation question left:

1. **Can UD serve cleanly infer/use the built `apiRootPath` without exposing an
   `--apiRootPath` serve flag, or do we need a temporary serve-time fallback
   argument for this refactor?**

Everything else needed for the plan direction now appears decided enough to
start implementation once that answer is clear.

## Future work

### 1. Unified Vite build pipeline

There is a real architectural tension in the current two-build setup. The likely
end state is a more unified Vite build pipeline that removes duplicated setup,
reduces shared global UD store awkwardness, and makes plugin/environment
coordination cleaner.

However, that should come **after** this refactor, not before it.

Reasoning:

- the important contract to stabilize first is **artifact shape vs hosting**
- once the artifact is cleanly separated from its local host, build unification
  becomes an internal cleanup rather than a contract-defining change
- trying to unify the build first would increase scope and couple Vite builder
  orchestration changes to the serve refactor

So unified build remains the likely next architectural step, but is explicitly
out of scope for this implementation.

### 2. Alternative HTTP hosts

Add support for alternative HTTP hosts such as Fastify while preserving the same
"import Fetchable and host it externally" contract.

### 3. Optional single-port local serve

A future single-port local serve mode may still be useful, but it is not needed
to accomplish this refactor's goals.

## Recommended implementation sequence

1. Update `buildUDApiServer()` so it resolves and bakes `apiRootPath`, loads
   user config, and preserves Cedar-owned plugin injection plus adapter-free
   output.
2. Decide whether UD serve can cleanly avoid exposing `--apiRootPath` entirely,
   or whether a temporary serve-time compatibility flag is needed.
3. Implement a reusable UD import-and-host helper for srvx.
4. Switch `serve api --ud` to in-process srvx hosting.
5. Switch `serve --ud` to use the same imported Fetchable on the API side while
   keeping the split web/API topology.
6. Add integration coverage for provider plugins in user Vite config and for
   build-time `apiRootPath` behavior.
7. Re-evaluate unified-build follow-up work once the artifact/serve boundary is
   stable.


