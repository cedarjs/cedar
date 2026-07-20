# Problem: `--ud` dev logs are unformatted

## Background

CedarJS's `yarn cedar dev` command has two modes:

1. **Default mode**: the CLI spawns the api server and the web dev server as
   separate OS processes, orchestrated via `concurrently`
   (`packages/cli/src/commands/dev/devHandler.ts`). The api server's process
   is started as `nodemon --exec "cedar-api-server-watch ... | cedar-log-formatter"`
   — its raw stdout is piped, at the shell level, through a dedicated
   `cedar-log-formatter` binary before `concurrently` ever sees it. That
   formatter (`packages/api-server/src/logFormatter/`) parses the app's raw
   pino NDJSON log lines and pretty-prints them (colored level, timestamp,
   HTTP method/status, GraphQL operation name, etc.), styled after
   pino-colada. `concurrently` separately adds its own `{name} |` prefix,
   color, and timestamp around each process's output, on top of whatever
   that process already wrote.

2. **`--ud` ("unified dev") mode**: instead of a separate api server process,
   the api runs *in-process* inside the same Node process as the Vite web
   dev server, attached as Vite SSR middleware
   (`packages/vite/src/cedar-unified-dev.ts`,
   `packages/vite/src/apiDevMiddleware.ts`). There is only one OS process,
   and its stdout is shared between Vite's own (already colored/formatted)
   console output and the api's pino logger output. Nothing in this path
   applies `cedar-log-formatter` (or equivalent) to the api's log lines, so
   they print as raw, unformatted JSON (e.g.
   `{"level":30,"time":...,"msg":"..."}`) interleaved with Vite's normal
   output.

The api's logger is created via `createLogger()` in
`packages/api/src/logger/index.ts`, which wraps `pino`. When no custom
`destination` is supplied (the common case — most apps' `api/src/lib/logger.ts`
call `createLogger()` without one), pino's default destination writes
directly to file descriptor 1 (stdout) via its internal `SonicBoom` stream,
**not** via `process.stdout.write()`. This means any fix that works by
patching/wrapping `process.stdout.write` at the process level will not
intercept these log lines.

## Constraint

`@cedarjs/api` (the package that owns `createLogger()`) ships as a runtime
dependency in every deployed CedarJS api — Docker images, Lambda bundles,
etc. Its current dependency list is deliberately small (`pino`,
`@prisma/client`, `jsonwebtoken`, a handful of small utilities). The existing
`cedar-log-formatter` implementation lives in `@cedarjs/api-server`
(`packages/api-server/src/logFormatter/index.ts` +
`packages/api-server/src/logFormatter/formatters.ts`), which depends on
`ansis`, `fast-json-parse`, `pretty-bytes`, and `pretty-ms`.

Separately, `packages/api-server` and `packages/vite` (the packages
involved in the `--ud` dev path) both already depend on `@cedarjs/internal`,
a much larger package (193 total dependency entries, including `typescript`,
`ts-node`, `esbuild`, `vite`, `@prisma/internals`, and the full
`graphql-codegen`/`graphql-tools` toolchain) meant for CLI/build-time
tooling. `@cedarjs/api` does not currently depend on `@cedarjs/internal` or
`@cedarjs/api-server`.

Whatever change is made must not increase the size of what gets installed
into a production deployment of a CedarJS api — this behavior only matters
during local development (`yarn cedar dev --ud`).

## Question

What is the best way to make the api server's log output, when running
under `yarn cedar dev --ud`, go through the same (or equivalent) formatting
that it already gets under plain `yarn cedar dev`, without adding to the
production dependency/deployment footprint of a CedarJS api?
