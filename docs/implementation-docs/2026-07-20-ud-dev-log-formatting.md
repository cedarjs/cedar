# Pretty-Printed API Logs in `--ud` Dev Mode

**Date:** 2026-07-20
**PR:** [cedarjs/cedar#2140](https://github.com/cedarjs/cedar/pull/2140)

## Problem

`yarn cedar dev` produces nicely formatted api logs (colored level, timestamp,
HTTP method/status, GraphQL operation name, etc.). `yarn cedar dev --ud`
(unified dev server) did not — api log lines printed as raw, unformatted pino
NDJSON (e.g. `{"level":30,"time":...,"msg":"..."}`), interleaved with Vite's
own console output.

### Why the two modes differ

- **Default mode**: the CLI spawns the api server and web dev server as
  separate OS processes via `concurrently`
  (`packages/cli/src/commands/dev/devHandler.ts`). The api job is built as
  `nodemon --exec "cedar-api-server-watch ... | cedar-log-formatter"` — the
  api process's raw stdout is piped, at the shell level, through a dedicated
  `cedar-log-formatter` binary before `concurrently` ever sees it.
  `cedar-log-formatter` (`packages/api-server/src/logFormatter/`) parses pino
  NDJSON and pretty-prints it, styled after pino-colada.

- **`--ud` mode**: the api runs _in-process_ inside the same Node process as
  the Vite web dev server, attached as Vite SSR middleware
  (`packages/vite/src/cedar-unified-dev.ts`,
  `packages/vite/src/apiDevMiddleware.ts`). Nothing in that path applied
  `cedar-log-formatter` (or equivalent) to the api's log lines.

### A key constraint on pino

The api's logger is created via `createLogger()` in
`packages/api/src/logger/index.ts`, which wraps `pino`. When no custom
`destination` is supplied — the common case, since most apps'
`api/src/lib/logger.ts` call `createLogger()` without one — pino's default
destination writes directly to file descriptor 1 via its internal `SonicBoom`
stream, **not** via `process.stdout.write()`. Any fix based on
patching/wrapping `process.stdout.write` at the process level would not have
intercepted these log lines. (An OS-level pipe, by contrast, captures fd 1
directly and isn't affected by this.)

### The production-footprint constraint

`@cedarjs/api` ships as a runtime dependency in every deployed CedarJS api
(Docker images, Lambda bundles, etc.), and is deliberately kept small (`pino`,
`@prisma/client`, `jsonwebtoken`, a handful of small utilities).
`@cedarjs/api-server` (home of the existing `cedar-log-formatter`) and
`@cedarjs/vite` both already depend on `@cedarjs/internal` — a much larger
package (193 total dependency entries, including `typescript`, `ts-node`,
`esbuild`, `vite`, `@prisma/internals`, and the full
`graphql-codegen`/`graphql-tools` toolchain) meant for CLI/build-time tooling.
Any fix had to avoid adding to `@cedarjs/api`'s production dependency
footprint.

## Solutions explored

We worked through several approaches, roughly in this order, discarding each
for a documented reason. A couple of early dismissals turned out to rest on
incorrect assumptions — worth reading even though they weren't used. One
approach (the shell pipe, below) was actually implemented, shipped, and
subsequently reverted after two rounds of code review found real bugs in it —
see **The pipe attempt: shipped, then reverted** for the full story, and
**Decision** for what replaced it.

### 1. Patch `process.stdout.write` in-process

Rejected immediately: pino's default destination (`SonicBoom`) writes
directly to fd 1, bypassing `process.stdout.write` entirely. This wouldn't
have seen the log lines at all.

### 2. Vite's `customLogger` / `LoggerOptions.console` extension points

Vite does expose a real extension point for its own logging — `customLogger`
(`LoggerOptions.customLogger`) and `LoggerOptions.console` let you replace
how Vite's `Logger` (`info`/`warn`/`warnOnce`/`error`/...) writes output.
Rejected because this only governs messages that explicitly go through
Vite's own logger API (HMR messages, build errors, or anything a plugin
deliberately calls `server.config.logger.info(...)` for). Since the api's
pino logger writes independently to fd 1 (see above), it never touches
Vite's logger at all, so this extension point can't see it.

### 3. Add `@cedarjs/internal` (or `@cedarjs/api-server`) as a dependency of `@cedarjs/api`

Rejected outright on the production-footprint constraint — see above.
`@cedarjs/api` does not currently depend on either package, and adding
`@cedarjs/internal` in particular would drag `typescript`, `ts-node`,
`esbuild`, `vite`, and the graphql-codegen toolchain into every deployed api.

### 4. A build-mode-conditional Vite virtual module

Idea: register a virtual module (e.g. `virtual:cedar-log-destination`) whose
`load()` hook returns different content depending on `config.command`
(`'serve'` vs `'build'`) — pretty-printing in dev, a raw passthrough in
production.

Rejected after checking which build paths actually run Vite's plugin
container for `api/src`:

- Default `yarn cedar build` (no `--ud`): `api/src` is transpiled via
  **esbuild with `bundle: false`**, one file at a time
  (`packages/internal/src/build/api.ts`). No Vite plugin container runs at
  all — a `virtual:...` import would survive untouched into `api/dist` and
  fail to resolve at runtime.
- `yarn cedar build --ud`: this one _does_ run a real `vite build()` against
  the project's actual `web/vite.config.ts` (`packages/vite/src/buildApp.ts`),
  so a virtual-module plugin's hooks would genuinely execute here.

Since `dev --ud` and `build --ud` are independent flags, a project could
reasonably dev with `--ud` while still deploying via the default (non-Vite)
production build. An unconditional virtual-module import would work in dev
and break that production build. This approach only becomes viable if scoped
strictly to the `--ud` build pipeline, which is a fragile thing to guarantee
project-wide.

### 5. Customize the app's own `api/src/lib/logger.ts`

Idea: since `api/src/lib/logger.ts` is the officially scaffolded
customization point for `createLogger()` (part of the app template, not
framework code), have it construct a dev-only formatting `destination`
itself — with the formatter as a devDependency of the _app's own_
`api/package.json`, not `@cedarjs/api`.

This is a solid idea and satisfies the footprint constraint cleanly (app
devDependencies are excluded from production installs same as framework
devDependencies). The tradeoff: it only helps apps that have this in their
`logger.ts` — new apps generated from an updated template, or existing apps
that manually copy the change in. It's not a fix that every existing CedarJS
app gets automatically. We moved on in search of something that would apply
retroactively, which led to the next idea.

### 6. Intercept the `@cedarjs/api/logger` import in dev — **this is what we ended up shipping**

`createApiViteServer()` (`packages/vite/src/apiDevMiddleware.ts`) already
builds a **dev-only** Vite instance (used only by `startApiDevMiddleware()`,
only ever called from `cedar-unified-dev.ts`) with its own `plugins: [...]`
array. A plugin registered there can intercept Vite's _module resolution_
for a specific bare specifier — `@cedarjs/api/logger` — and redirect it to a
wrapped implementation, entirely at the dev server layer, with **zero
changes to any app code and zero changes to `@cedarjs/api` itself**.

This was the design we came closest to shipping the first time around, then
set aside in favor of something that looked simpler (see the next section).
After that simpler approach ran into real trouble, we came back to this one
— see **Decision** below for the full writeup, since it's now the shipped
design rather than a hypothetical.

### 7. The pipe attempt: shipped, then reverted

While first writing up the interception design (option 6) for review, a
different fix surfaced that looked strictly simpler: **`--ud` still runs as
a single spawned OS process under `concurrently`**
(`jobs.push({ name: 'dev', command: unifiedDevCommand, ... })` in
`devHandler.ts`) — "in-process" only describes how the api and web dev
server share one process, not whether that process itself is spawned by the
CLI. Since there's a real OS-level stdout to work with, the reasoning went,
we could pipe it through `cedar-log-formatter` exactly the way the fallback
`api` job already does: append `` `| ${formatRunBinCommand('cedar-log-formatter')}` ``
to the unified dev command string.

Two things made this look safe, not just plausible:

1. **`concurrently` spawns every job through a shell**
   (`node_modules/concurrently/dist/src/spawn.js` calls `spawn('/bin/sh', ['-c', command], ...)`
   on POSIX, `cmd.exe /s /c` on Windows), so a `|` in the command string is a
   real shell pipe.
2. **`cedar-log-formatter` passes through non-pino-NDJSON lines unchanged**
   (`LogFormatter().parse()` returns `inputData + NEWLINE` verbatim for
   anything that isn't pino-shaped JSON) — so Vite's own colored output
   would flow through untouched, and only the api's raw NDJSON lines would
   get pretty-printed. This directly invalidated an earlier assumption (made
   during initial research on this problem) that piping the whole `--ud`
   process's stdout through the formatter would corrupt Vite's console
   output.

This shipped as the first version of the fix. It did not survive code
review, in two rounds:

**Round 1 — exit codes get masked.** A shell pipeline's own exit code
(without `pipefail`) is whatever the _last_ command in it exits with — not
the piped-_from_ command's. If `cedar-unified-dev` crashed,
`cedar-log-formatter` would just see its stdin close (EOF) and exit 0,
which would make `concurrently` (and thus `cedar dev --ud`'s own exit code,
via the `result.then`/`.catch` in `devHandler.ts`) report success on a real
server failure. Verified directly:

```
sh -c '(exit 7) | cat'; echo $?      # → 0, masked
```

The fix at the time: force `bash -c 'set -o pipefail; ...'` rather than
relying on `set -o pipefail` against whatever `/bin/sh` happens to be —
`dash` (the default `/bin/sh` on many Linux distros) aborts the entire
script outright if asked for an option it doesn't support:

```
dash -c 'set -o pipefail; echo hi'   # → "Illegal option", "hi" never prints
```

**Round 2 — the fix above wasn't portable either.** Forcing `bash`
regressed on Alpine-based dev/CI environments, which ship only BusyBox
`ash` and have no `bash` at all — `cedar dev --ud` would fail outright with
`bash: not found` before the server even started. And separately, the
`bash -c 'set -o pipefail; ...'` fix never actually covered Windows in the
first place (`cmd.exe` has no `pipefail` equivalent), so the masking bug
from round 1 was _still_ live there.

**The response to round 2**, before this was reconsidered, was to replace
the shell pipe with `cedar-log-formatter` directly spawning
`cedar-unified-dev` as a child process (via Node's `child_process`, not a
shell pipe) and exiting with its real exit code — portable by construction,
since it doesn't depend on any shell's exit-status semantics. The command to
run was passed through a `CEDAR_LOG_FORMATTER_COMMAND` env var rather than a
CLI argument, because by the time `cedar-log-formatter` runs, the original
command string has already been tokenized into argv by the outer shell,
which throws away its quoting — and there's no generally-correct way to
reconstruct that quoting from the tokenized pieces (an attempt at
re-quoting only whitespace-containing args broke on a plain
`node -e "process.exit(0)"`, since the unquoted parens are shell
metacharacters). Env vars aren't shell-parsed at all, so passing the
command that way sidesteps the problem entirely.

This version was technically correct — verified with both manual spawn
tests and an automated subprocess test suite — but architecturally it asks
a tool named "log formatter" to also be a process supervisor (spawning a
child, forwarding signals, propagating exit codes), and to receive a shell
command through an environment variable rather than a normal argument. Both
are legitimate design smells, independent of whether the code works. That
observation is what sent this document back to option 6.

**Why this was harder for `--ud` than for the legacy fallback job in the
first place:** the fallback job's api process is spawned via
`nodemon --exec "... | cedar-log-formatter"` — `nodemon` itself is the
process `concurrently` spawns and watches, and `nodemon` never propagates
the exec'd command's exit code as its own (it's a persistent watcher that
just logs a crash and waits to restart). So the exit-code-masking quirk is
latent there too, but inert: `concurrently` never observed the piped
command's exit code in legacy mode to begin with. `--ud` mode has no such
buffer process — `concurrently` spawns the dev server directly, and its
exit code _is_ the signal `cedar dev --ud`'s own exit code is built on.
Inserting _any_ second process between the server and `concurrently` (a
pipe, a supervisor) reintroduces a problem legacy mode never had, which is
exactly why option 6 — formatting inside the one process that already
exists, so there's never a second process in that position — is the
structurally sound answer rather than a series of increasingly elaborate
patches to a shell pipe.

## Decision: the `@cedarjs/api/logger` interception design

What actually shipped is option 6 above. The mechanism:

```ts
// packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts (sketch)
import type { Plugin } from 'vite'

const VIRTUAL_MODULE_ID = 'virtual:cedar-api-logger-dev'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

export function cedarApiLogFormatterDevPlugin(): Plugin {
  return {
    name: 'cedar-api-log-formatter-dev',
    enforce: 'pre',
    resolveId(id, importer) {
      // Guard against the virtual module's own import of the real
      // package below recursing back into this branch.
      if (
        id === '@cedarjs/api/logger' &&
        importer !== RESOLVED_VIRTUAL_MODULE_ID
      ) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }
      return null
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null
      }
      return `
        import * as realLogger from '@cedarjs/api/logger'
        import { LogFormatter } from '@cedarjs/api-server/logFormatter'

        export * from '@cedarjs/api/logger'

        function createFormattingDestination() {
          let buffered = ''
          const format = LogFormatter()
          return {
            write(chunk) {
              buffered += chunk
              const lines = buffered.split('\\n')
              buffered = lines.pop() ?? ''
              for (const line of lines) {
                if (line.length > 0) process.stdout.write(format(line))
              }
              return true
            },
          }
        }

        export function createLogger(params = {}) {
          if (params.destination) return realLogger.createLogger(params)
          return realLogger.createLogger({
            ...params,
            destination: createFormattingDestination(),
          })
        }
      `
    },
  }
}
```

Registered only inside `createApiViteServer()`'s `plugins` array.

### Why each piece is necessary

- **`enforce: 'pre'`**: Vite's plugin resolution order is
  `[alias] → [enforce:'pre' user plugins] → [Vite core plugins] → [normal
user plugins] → ...`. Vite's own SSR module resolver (part of "Vite core
  plugins") is what decides whether a bare `node_modules` specifier gets
  externalized (resolved via plain Node `require`, bypassing Vite's plugin
  pipeline for its content). Registering with `enforce: 'pre'` guarantees our
  `resolveId` runs _before_ that default externalization logic, so we get
  first refusal on the specifier.
- **The `importer !== RESOLVED_VIRTUAL_MODULE_ID` guard**: the wrapper module
  itself needs to `import * as realLogger from '@cedarjs/api/logger'` to get
  at the real `createLogger`. Without this guard, that import would trigger
  our own `resolveId` again and recurse forever. Because the importer for
  that specific import is the virtual module itself, the guard lets it fall
  through to Vite's normal (now unblocked) resolution, which resolves to the
  actual package.
- **`export * from '@cedarjs/api/logger'` plus a local `export function
createLogger`**: per the ECMAScript module spec, a local export binding
  always takes precedence over a star-re-export of the same name — this is
  the standard "wrap one export, pass the rest through unchanged" pattern,
  and it's honored correctly by Vite/esbuild/Node.
- **Destination shape**: pino's `DestinationStream` is deliberately minimal —
  `{ write(msg: string): void }` (`node_modules/pino/pino.d.ts`). No need for
  a full Node `Writable`; a plain object with a `write` method is a valid
  destination and can be constructed inline.
- **Only overriding when no `destination` was already passed**: some apps or
  advanced setups configure a custom destination themselves (e.g. writing to
  a file); the wrapper must not clobber that.
- **Types stay correct for free**: TypeScript type-checks `api/src/lib/logger.ts`
  against the real `@cedarjs/api/logger` package's `.d.ts` — the type checker
  never talks to Vite's runtime resolver. Only the _runtime_ module Vite
  serves is swapped, so there's no type-declaration drift to maintain.

### Why this is the right pattern here

- **`concurrently` spawns `cedar-unified-dev` directly, exactly as it did
  before any of this work** — no wrapper command, no supervisor process, no
  change to `devHandler.ts` at all. Its exit code is trivially correct
  because there was never a second process in the way to begin with. This is
  the property every iteration of the pipe attempt (above) had to work
  increasingly hard to fake.
- **Retroactive**: every existing app benefits with no code changes, since
  the interception happens purely at Vite's resolve layer for a specifier
  that already exists in every app's `api/src/lib/logger.ts`.
- **Zero production footprint, structurally, not just "small"**: this plugin
  is only ever constructed inside `createApiViteServer()`, which only
  `cedar-unified-dev.ts` calls. Neither production build path (the default
  esbuild build, or `cedar build --ud`'s real Vite build via
  `buildApp.ts`) loads this dev server config at all — so there's no
  conditional to get wrong and no risk of a stray specifier leaking into a
  shipped bundle.
- **No new dependency edges on `@cedarjs/api`**: the formatter package
  (`@cedarjs/api-server/logFormatter`, exposed via a new export subpath) and
  the wrapper module both live entirely inside `@cedarjs/vite`, which is a
  **devDependency** in the app template (confirmed:
  `packages/create-cedar-app/templates/ts/web/package.json`), so this
  subtree is already excluded from most production installs regardless of
  its own size.

### Known minor side effect

`createLogger()` (`packages/api/src/logger/index.ts`) logs a one-time
`console.warn('Logs will be sent to the transport stream in the current
development environment.')` whenever it's given a stream `destination` in
development — a warning meant for apps that explicitly configure a custom
destination themselves. Since this plugin now always injects one under
`--ud`, that warning prints on every `--ud` dev session, even though nothing
is actually misconfigured. Cosmetic only (fires once at startup, not
per-request); left as-is rather than special-cased, since avoiding it would
mean changing `@cedarjs/api`'s own warning condition to know about a
dev-only implementation detail from a different package.

### When to reach for this pattern again

This "dev-only Vite specifier interception" pattern is the right tool when:

- You need to swap the _runtime_ behavior of a specific framework package
  export, only in dev, only under `--ud` (or another Vite-SSR-based dev
  path), and
- There's no already-spawned OS process boundary to exploit instead — and
  even when there technically is one (as `--ud` turned out to have), prefer
  this pattern anyway if using that process boundary would mean interposing
  a _new_ process between something and whatever already depends on its exit
  code, and
- The affected package is imported from app-owned source that Vite's SSR
  loader actually processes (confirmed for `api/src/**` via
  `viteServer.ssrLoadModule()` in `apiDevMiddleware.ts`) — not from deep
  inside another framework package's own internals, which Vite's SSR mode
  externalizes by default and won't run through your plugin's `resolveId`
  unless you also add it to `ssr.noExternal`.

## Files changed

| File                                                                              | Change                                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/api-server/package.json`                                                | New `./logFormatter` export subpath                                                                |
| `packages/vite/package.json`                                                      | New `@cedarjs/api-server` dependency                                                               |
| `packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts`                | New dev-only Vite plugin implementing the interception                                             |
| `packages/vite/src/plugins/__tests__/vite-plugin-cedar-log-formatter-dev.test.ts` | New unit tests for the plugin's `resolveId`/`load` hooks                                           |
| `packages/vite/src/apiDevMiddleware.ts`                                           | Registers the plugin in `createApiViteServer()`'s `plugins` array                                  |
| `tasks/ud-tests/udDev.test.mts`                                                   | New end-to-end test: a live GraphQL request's logs are pretty-printed, not raw pino NDJSON         |
| `packages/cli/src/commands/dev/devHandler.ts` + its test                          | Reverted to their pre-investigation state — no formatter wiring needed at the CLI level            |
| `packages/api-server/src/logFormatter/bin.ts`                                     | Reverted to its pre-investigation state (plain stdin-formatting mode only, used by the legacy job) |

## Related

- `packages/api-server/src/logFormatter/` — `cedar-log-formatter` implementation (pino-colada-style)
- `packages/vite/src/apiDevMiddleware.ts` — `createApiViteServer()`, the dev-only Vite instance hosting the interception plugin
- `packages/vite/src/cedar-unified-dev.ts` — unified dev server entry point
- `docs/implementation-docs/2026-06-29-debug-port-inspector-ud-mode.md` — another `--ud`-mode-specific fix, similar "single spawned process, two logical processes" architecture considerations
