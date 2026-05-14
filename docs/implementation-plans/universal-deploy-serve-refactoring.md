# Refactoring: Adapter-Agnostic Build + Adapter-Free Serve

## Summary

Separate the Fetchable build output from the HTTP server wrapper so that
`cedar build --ud` produces a pure WinterTC-compatible artifact regardless of
which deployment plugins the user has in their vite config, and
`cedar serve --ud` provides the local Node HTTP server (srvx).

## Motivation

Currently `cedar build --ud` embeds the HTTP server startup code into the built
artifact via `@universal-deploy/node` (auto-detected by `universalDeploy()` from
`@universal-deploy/vite`). This creates problems:

- **Config duality**: The same vite config can't serve both local testing (needs
  Node server startup) and remote deployment (needs Netlify/Vercel output). The
  user has to maintain separate configs or use env vars.
- **Runtime lock-in**: The built artifact is tied to Node. Can't test the same
  artifact on Bun, Deno, or workerd without rebuilding.
- **Adapter coupling**: Changing the HTTP server (e.g. srvx → Fastify) requires
  changing the build config, even for local testing.

## Approach

### Principle: Build produces Fetchable, Serve wraps Fetchable

The `api/dist/ud/index.mjs` output is always a pure `export default { fetch }`
WinterTC-compatible module. No server startup code, no provider-specific
wrapping. `cedar serve --ud` is where the HTTP server lives — it imports the
Fetchable and wraps it for local development.

### What changes

#### 1. `cedar build --ud` produces a pure Fetchable

Remove `universalDeploy()` from `buildUDApiServer`. Use the individual plugins
from `@universal-deploy/vite` that `buildUDApiServer` actually needs:
`catchAll()` (generates the rou3 route dispatcher) and `devServer()` (for
`cedar dev --ud`). Do NOT include the Node adapter auto-detection.

The `cedarUniversalDeployPlugin()` continues to register per-route entries with
the UD store and generate per-function virtual modules.

The build output structure is always:

```
api/dist/ud/
  index.mjs          # export default { fetch } — pure Fetchable
  assets/            # per-function chunks (lazy-loaded by index.mjs)
    graphql-*.mjs
```

The user's vite config can include any deployment plugins (Netlify, Vercel,
etc.) without affecting the build output. Those plugins produce their own
additional artifacts alongside the Fetchable.

#### 2. `cedar serve --ud` hosts the Fetchable locally

`cedar serve --ud` (both sides) currently starts a Fastify web proxy and forks
the UD server as a child process. Instead, it should:

1. Dynamically import `api/dist/ud/index.mjs`
2. Wrap the Fetchable in srvx's `serve()`
3. Serve `web/dist/` as static files via srvx's `serveStatic`
4. Single HTTP listener serving both web and API on one port

`cedar serve api --ud` starts the same srvx server without static file serving
(for use behind a reverse proxy like nginx).

srvx is the default HTTP server. To support alternatives (Fastify, Bun, Deno),
the serve handler is pluggable — see Future Work below.

#### 3. `cedar dev --ud` continues to use Vite's dev server

No change needed. The dev server already handles both web and API inline via
Vite middleware, not via the built Fetchable.

### Files to modify

#### `packages/vite/src/buildUDApiServer.ts`

- Remove dynamic imports of `universalDeploy` and `cedarUniversalDeployPlugin`
  (the plugin comes from the user's config file now).
- Remove the `plugins` array from the `build()` call.
- Call `build()` with only `configFile`, `logLevel`, `environments`, and
  `build: { ssr: true }`.
- Pass `configFile: rwPaths.web.viteConfig` to `build()` so the user's
  deployment plugins (Netlify, etc.) are active. This was already added in an
  earlier refactoring — see git history around May 2026 for the change that
  replaced the hardcoded plugin list with `configFile`.
- Ensure `cedarUniversalDeployPlugin` is in the user's config (or add a safety
  check that warns if it's missing).

#### `packages/cli/src/commands/serve.ts`

Refactor the `ud` path in both the `$0` and `api` subcommand handlers:

- Replace `fork(udEntryPath, ...args)` with import + srvx `serve()`.
- Remove the Fastify web proxy in the `$0` handler (srvx handles static files
  now).
- Handle graceful shutdown (SIGINT/SIGTERM → server.close()).

The serve handler should:

```ts
// Pseudocode
async function startUDServer(entryPath: string, options: ServeOptions) {
  const fetchable = await import(entryPath)

  const staticDir = options.serveWeb
    ? path.join(getPaths().web.dist, 'index.html')
    : undefined

  const server = serve({
    ...fetchable,
    static: staticDir,
    gracefulShutdown: true,
  })

  server.serve()
  await server.ready()

  // Handle shutdown
  process.on('SIGINT', () => server.close())
  process.on('SIGTERM', () => server.close())
}
```

#### `packages/vite/src/buildApp.ts` (or `packages/cli/src/commands/build/buildHandler.ts`)

Consider whether `buildCedarApp` and `buildUDApiServer` can be merged into a
single build step. Currently they're sequential: web client + API functions
first, then UD server entry. Since `buildUDApiServer` now uses the same
`configFile` as `buildCedarApp`, they could potentially share a single Vite
builder. This is optional — the two-step build may still be the cleanest
approach.

Do not do this now. Keep the two-step build as-is.

#### `packages/vite/src/plugins/vite-plugin-cedar-universal-deploy.ts`

No structural changes needed. The `clearCedarEntries()` fix and relative path
generation via `new URL(relPath, import.meta.url)` — see the
`generateGraphQLModule` and `generateFunctionModule` functions in the plugin
file. The `clearCedarEntries()` function was also added to prevent stale entries
from accumulating in the UD store across build steps.

### User-facing changes

| Before                                                   | After                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `cedar build --ud` produces a self-starting Node server  | `cedar build --ud` produces a pure Fetchable                      |
| `cedar serve api --ud` forks the built entry             | `cedar serve api --ud` imports + wraps in srvx                    |
| `cedar serve --ud` creates Fastify web proxy + forks API | `cedar serve --ud` runs a single srvx server for both web and API |
| vite config with Netlify plugins breaks local serve      | vite config with any adapter plugins still works locally          |

### Developer experience workflow

```sh
# Local development
yarn cedar dev --ud # Vite dev server (HMR for web + API)

# Local prod-like testing
yarn cedar build --ud # web/dist/ + api/dist/ud/ (Fetchable)
yarn cedar serve --ud # srvx serves everything on one port
# or
yarn cedar serve api --ud # srvx serves API only (behind nginx)

# Deploy to Netlify/Vercel (CI/CD)
yarn cedar build --ud # Build with Netlify plugins in config
npx netlify deploy    # Netlify CLI handles deployment

# VPS/Baremetal
yarn cedar build --ud # Build with Node plugins in config
# Copy api/dist/ and web/dist/ to VPS
nginx -c cedar-web.conf # Serve web/dist/, proxy /api/* to srvx
cedar serve api --ud    # Start API server on VPS
```

### Edge cases

- **`cedarUniversalDeployPlugin` missing from user config**: `buildUDApiServer`
  should fail with a clear message.
- **`api/dist/ud/index.mjs` doesn't exist when serve is called**: Already
  handled — `serve.ts` checks with a clear error message.
- **No GraphQL or API functions**: `cedarUniversalDeployPlugin` registers no
  entries, catch-all generates an empty router that returns 404. srvx still
  starts and serves static files.

### Test plan

1. **Unit tests**: Update `createGraphQLHandler` and `createFunctionHandler`
   tests (already done — see `packages/vite/src/ud-handlers/` and its
   `__tests__/` directory). Add tests for the new `startUDServer` function.
2. **Integration test**: `cedar build --ud` → `cedar serve api --ud` →
   `curl localhost:8911/graphql` → 200 with GraphQL response.
3. **Integration test**: Same flow but with Netlify plugins in the user's vite
   config — verify the serve path still works.
4. **SPA test**: `cedar serve --ud` → `curl localhost:8910/` → serves
   `web/dist/index.html`. `curl /graphql` → GraphQL response.
5. **404 test**: `curl /nonexistent` → 404 (not SPA shell for API routes).

### Future work

- **Pluggable HTTP server**: `cedar serve` could support alternative HTTP
  servers via a configuration option or a plugin registration system. For
  example: `cedar serve --http-server=bun` or a `@cedarjs/adapter-fastify`
  package that provides a serve handler.
- **Unified build step**: Merge `buildCedarApp` and `buildUDApiServer` into a
  single `cedar build` with declared environments. This would eliminate the
  two-step build and the shared global UD store issue.
- **Web fallback entry**: Re-implement the `virtual:cedar-web` virtual module
  (removed in Phase 6 addendum) for runtimes that serve web and API in a single
  process. Currently not needed since `cedar serve` handles this.
