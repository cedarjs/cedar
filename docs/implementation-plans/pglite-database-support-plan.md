# PGlite Database Support for create-cedar-app

## Table of Contents

- [Overview](#overview)
- [Reference Example](#reference-example)
- [Architecture Decisions](#architecture-decisions)
- [CLI Changes](#cli-changes)
- [Database Overlay Structure](#database-overlay-structure)
- [File Contents](#file-contents)
  - [schema.prisma](#schemaprisma)
  - [db.ts](#dbts)
  - [api/package.json](#apipackagejson)
  - [.env.defaults](#envdefaults)
- [gitignore.template Update](#gitignoretemplate-update)
- [Overlay Application Logic](#overlay-application-logic)
- [Validation](#validation)
- [Telemetry](#telemetry)
- [Complete File Change Summary](#complete-file-change-summary)
- [How It Works at Runtime](#how-it-works-at-runtime)
- [User-Facing Usage](#user-facing-usage)
- [Future Considerations](#future-considerations)

---

## Overview

Add a hidden `--database` / `--db` CLI flag to `create-cedar-app` that allows
users to generate a new Cedar app using
[PGlite](https://github.com/electric-sql/pglite) (an in-process PostgreSQL
compiled to WASM) instead of the default SQLite database.

When the user runs:

```bash
yarn create cedar-app --esm --db pglite my-app
```

The generated app will use PGlite for local development with on-disk persistence
at `api/db/pglite-data/`, while still being compatible with a real PostgreSQL
database in production by changing the `DATABASE_URL` environment variable.

The default behavior (no `--db` flag) remains unchanged: SQLite via
`better-sqlite3`.

---

## Reference Example

The implementation is based on the working example at:
`/Users/tobbe/tmp/pglite-llm-gen/`

Key patterns from the example:

- **Socket server approach**: PGlite is wrapped in a `PGLiteSocketServer` that
  listens on `127.0.0.1:5433`, making it look like a standard PostgreSQL server
  to any client.
- **PrismaPg adapter**: Prisma connects via `@prisma/adapter-pg` (the standard
  `pg` driver) to the PGlite socket server. The connection string is
  `postgresql://postgres:postgres@127.0.0.1:5433/postgres`.
- **No `url` in schema.prisma**: The datasource block uses
  `provider = "postgresql"` with no `url` field. The connection is established
  programmatically via the adapter.
- **Prisma v7 driver adapters**: The example uses `@prisma/adapter-pg` v7.5.0
  with PrismaClient constructor options.

---

## Architecture Decisions

### ESM-only

PGlite support requires the `--esm` flag. This is a deliberate constraint for
two reasons:

1. **Top-level `await`**: PGlite initialization is async (`await PGlite.create()`).
   Cedar's esbuild API build uses `format: 'esm'` when the project is ESM
   (determined by `projectSideIsEsm('api')` in
   `packages/internal/src/build/api.ts:77`). Top-level await is supported in ESM
   output but not CJS.

2. **Simpler code**: No need for Proxy-based lazy initialization hacks. The db.ts
   file can use clean, straightforward top-level await.

### Socket server approach (not direct adapter)

The example uses `PGLiteSocketServer` rather than a hypothetical direct PGlite
Prisma adapter. Benefits:

- Same adapter code works for both PGlite (dev) and real PostgreSQL (prod) —
  only the connection string changes.
- Prisma CLI tools (`prisma migrate dev`, `prisma generate`) can connect to the
  socket server as if it were a real PostgreSQL database.
- Falls back to real PostgreSQL seamlessly: just set `DATABASE_URL` to a real
  Postgres URL and the same `PrismaPg` adapter connects to it.

### Module-level initialization (no custom server file)

PGlite is initialized at module load time in `api/src/lib/db.ts` using
top-level await. Cedar's API process imports db.ts before serving requests,
so the socket server has time to start before the first GraphQL query arrives.

No `api/src/server.ts` custom server file is needed.

### Prisma's migration support (no custom migration runner)

The reference example includes a custom `server/migrate.ts` that manually reads
migration SQL files and tracks them in a `_prisma_migrations` table. We do NOT
include this. Instead, the generated app relies on Cedar's standard Prisma
workflow:

```bash
yarn cedar prisma migrate dev    # Create and apply migrations
yarn cedar prisma db push        # Push schema changes without migration files
```

Because PGlite's socket server looks like a real PostgreSQL server, Prisma's
CLI tools work against it without modification. The `prisma.config.ts` (or
`.cjs`) file reads `DATABASE_URL` from the environment, which points at the
PGlite socket server during development.

---

## CLI Changes

**File**: `packages/create-cedar-app/src/create-cedar-app.ts`

### Add yargs option

After the existing `.option('esm', ...)` block, add:

```ts
.option('database', {
  alias: 'db',
  hidden: true,
  default: null,
  type: 'string',
  describe: 'Database to use (sqlite, pglite)',
})
```

### Extract flag from parsed args

After the existing flag extraction block (around line 883), add:

```ts
const databaseFlag = parsedFlags.database ?? null
```

### Pass to createProjectFiles

Update the `CreateProjectFilesOptions` interface to include:

```ts
interface CreateProjectFilesOptions {
  templateDir: string
  templatesDir: string
  overwrite: boolean
  packageManager: PackageManager
  useEsm: boolean
  database: string | null // Add this
}
```

Pass `database: databaseFlag` in the `createProjectFiles` call.

### Apply overlay in createProjectFiles

After the existing PM overlay copy (around line 245), add:

```ts
if (database === 'pglite') {
  const dbOverlayDir = path.join(
    templatesDir,
    '..',
    'database-overlays',
    'pglite'
  )
  await fs.promises.cp(dbOverlayDir, newAppDir, {
    recursive: true,
    force: true,
  })
}
```

This overwrites the SQLite-specific files (schema.prisma, db.ts,
package.json, .env.defaults) with the PGlite versions.

---

## Database Overlay Structure

Create a new directory alongside `templates/`:

```
packages/create-cedar-app/
  templates/           # Existing templates (unchanged)
  database-overlays/   # New directory
    pglite/            # PGlite overlay
      api/
        db/
          schema.prisma
        src/
          lib/
            db.ts
        package.json
      .env.defaults
```

Only one variant is needed because PGlite support is ESM-only. The overlay
mirrors the file paths of the ESM-TS template so that `fs.promises.cp` with
`force: true` overwrites the correct files.

---

## File Contents

### schema.prisma

**File**: `database-overlays/pglite/api/db/schema.prisma`

The only change from the base template's schema is the datasource provider.
The generator block is identical.

```prisma
// Don't forget to tell Prisma about your edits to this file using
// `yarn cedar prisma migrate dev` or `yarn cedar prisma db push`.
// `migrate` is like committing while `push` is for prototyping.
// Read more about both here:
// https://www.prisma.io/docs/orm/prisma-migrate

datasource db {
  provider = "postgresql"
}

generator client {
  provider               = "prisma-client"
  output                 = "./generated/prisma"
  moduleFormat           = "cjs"
  generatedFileExtension = "mts"
  importFileExtension    = "mts"
}

// Define your own datamodels here and run `yarn cedar prisma migrate dev`
// to create migrations for them and apply to your dev DB.
// TODO: Please remove the following example:
model UserExample {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
```

**Differences from SQLite schema**:

- `provider = "postgresql"` instead of `provider = "sqlite"` (line 8)
- PostgreSQL-specific column types (e.g., `SERIAL`, `TEXT`, `TIMESTAMPTZ`) can
  now be used in user-defined models, though the example model uses only
  portable types.

---

### db.ts

**File**: `database-overlays/pglite/api/src/lib/db.ts`

This completely replaces the SQLite `db.ts`. It initializes PGlite, starts the
socket server, and creates the PrismaClient with a PrismaPg adapter.

```ts
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'
import { getPaths } from '@cedarjs/project-config'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

const pgDataDir = path.join(getPaths().api.base, 'db', 'pglite-data')
const pglite = await PGlite.create(pgDataDir)
const pgliteServer = new PGLiteSocketServer({
  db: pglite,
  port: 5433,
  host: '127.0.0.1',
})
await pgliteServer.start()

const adapter = new PrismaPg({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres',
})
const prismaClient = new PrismaClient({
  log: emitLogLevels(['info', 'warn', 'error']),
  adapter,
})

handlePrismaLogging({
  db: prismaClient,
  logger,
  logLevels: ['info', 'warn', 'error'],
})

/**
 * Global Prisma client extensions should be added here, as $extend
 * returns a new instance.
 * export const db = prismaClient.$extend(...)
 * Add any .$on hooks before using $extend
 */
export const db = prismaClient
```

**Key details**:

- `path.join(getPaths().api.base, 'db')` resolves to the `api/db/` directory in the Cedar project.
  The PGlite data directory is created at `api/db/pglite-data/`, next to where
  `dev.db` would exist for SQLite projects.
- `PGlite.create(pgDataDir)` creates (or opens) a PostgreSQL data directory on
  disk. This is a full Postgres cluster directory, not a single file.
- `PGLiteSocketServer` wraps the PGlite instance in a TCP server on port 5433.
  The `start()` call is async but completes before any queries run because
  Cedar's API process imports this module during initialization, before the
  Fastify server starts accepting requests.
- The hardcoded connection string `postgresql://postgres:postgres@127.0.0.1:5433/postgres`
  points at the PGlite socket server. To use a real PostgreSQL database, the
  user would change `DATABASE_URL` in `.env` and modify this file to use
  `process.env.DATABASE_URL` instead (or add a conditional like the reference
  example).
- `top-level await` works because Cedar's esbuild uses `format: 'esm'` for ESM
  projects (see `packages/internal/src/build/api.ts:77`).

**How this differs from the SQLite db.ts**:

| Aspect             | SQLite db.ts                                | PGlite db.ts                                                |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------- |
| Adapter import     | `@prisma/adapter-better-sqlite3`            | `@prisma/adapter-pg`                                        |
| Adapter class      | `PrismaBetterSqlite3`                       | `PrismaPg`                                                  |
| URL resolution     | `resolveSqliteUrl()` for `file:./...` paths | Hardcoded to PGlite socket server                           |
| Extra dependencies | None                                        | `@electric-sql/pglite`, `@electric-sql/pglite-socket`, `pg` |
| Init timing        | Synchronous (adapter is sync)               | Async (top-level await for PGlite + socket server)          |
| Data storage       | Single file (`api/db/dev.db`)               | Directory (`api/db/pglite-data/`)                           |

---

### api/package.json

**File**: `database-overlays/pglite/api/package.json`

```json
{
  "name": "api",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@cedarjs/api": "3.1.0",
    "@cedarjs/graphql-server": "3.1.0",
    "@electric-sql/pglite": "^0.4.2",
    "@electric-sql/pglite-socket": "^0.1.2",
    "@prisma/adapter-pg": "^7.5.0",
    "pg": "^8.13.0"
  }
}
```

**Differences from the ESM-TS SQLite version**:

| SQLite dependency                         | Replaced with                                 |
| ----------------------------------------- | --------------------------------------------- |
| `@prisma/adapter-better-sqlite3: "7.5.0"` | `@prisma/adapter-pg: "^7.5.0"`                |
| `better-sqlite3: "12.8.0"`                | `pg: "^8.13.0"`                               |
| —                                         | `@electric-sql/pglite: "^0.4.2"` (new)        |
| —                                         | `@electric-sql/pglite-socket: "^0.1.2"` (new) |

The `"type": "module"` field is retained (required for ESM, which is a
prerequisite for PGlite support).

---

### .env.defaults

**File**: `database-overlays/pglite/.env.defaults`

```
# These environment variables will be used by default if you do not create any
# yourself in .env. This file should be safe to check into your version control
# system. Any custom values should go in .env and .env should *not* be checked
# into version control.

# schema.prisma defaults
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cedar

# disables Prisma CLI update notifier
PRISMA_HIDE_UPDATE_MESSAGE=true

# Option to override the current environment's default api-side log level
# See: https://cedarjs.com/docs/logger for level options, defaults to "trace" otherwise.
# Most applications want "debug" or "info" during dev, "trace" when you have issues and "warn" in production.
# Ordered by how verbose they are: trace | debug | info | warn | error | silent
# LOG_LEVEL=debug
```

**Key differences from SQLite .env.defaults**:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cedar` instead of
  `file:./db/dev.db`
- The `TEST_DATABASE_URL` line is removed (not applicable to PostgreSQL)
- The `DATABASE_URL` points at `localhost:5432` for the Prisma CLI (for running
  `prisma migrate dev` against a real local PostgreSQL). At runtime, the PGlite
  socket server listens on port 5433 and db.ts hardcodes the connection string
  to `127.0.0.1:5433`.

---

## gitignore.template Update

**Files** (all four templates):

- `packages/create-cedar-app/templates/ts/gitignore.template`
- `packages/create-cedar-app/templates/js/gitignore.template`
- `packages/create-cedar-app/templates/esm-ts/gitignore.template`
- `packages/create-cedar-app/templates/esm-js/gitignore.template`

Add the following line after the existing `dev.db*` entry (line 9):

```
api/db/pglite-data
```

This is harmless for SQLite projects (the directory won't exist) and required
for PGlite projects (the directory contains a full Postgres cluster with
binary data, WAL files, etc. that should not be committed).

The updated `.gitignore` section will look like:

```
dev.db*
api/db/pglite-data
api/db/generated/prisma
```

---

## Overlay Application Logic

**File**: `packages/create-cedar-app/src/create-cedar-app.ts`

In the `createProjectFiles` function, after the existing PM overlay copy
(line 245) and before `gitignore.template` rename (line 248), add:

```ts
// Apply database overlay if pglite is selected
if (database === 'pglite') {
  const dbOverlayDir = path.join(
    templatesDir,
    '..',
    'database-overlays',
    'pglite'
  )
  await fs.promises.cp(dbOverlayDir, newAppDir, {
    recursive: true,
    force: true,
  })
}
```

The `force: true` flag ensures the overlay files overwrite the base template
files. The copy order is:

1. Base template (`templates/esm-ts/`) → `newAppDir`
2. PM overlay (`overlays/esm/yarn/`) → `newAppDir` (overwrites package.json,
   adds .yarnrc.yml)
3. **Database overlay** (`database-overlays/pglite/`) → `newAppDir`
   (overwrites schema.prisma, db.ts, api/package.json, .env.defaults)

Step 3 must come AFTER step 2 so that the PGlite package.json overwrites
the PM-overlay-modified package.json with the correct PGlite dependencies.
The PM overlay's non-package.json files (like `.yarnrc.yml`) are preserved.

**Caveat**: The PM overlay may add entries to `api/package.json` (e.g.,
pnpm adds `"type": "module"`). Since the database overlay replaces the
entire `api/package.json`, any PM-specific additions to `api/package.json`
must be included in the database overlay's `api/package.json` as well.
Currently, only the root `package.json` is modified by PM overlays, not
`api/package.json`, so this is not an issue. But if PM overlays are ever
extended to modify `api/package.json`, the database overlay must be updated
to match.

---

## Validation

**File**: `packages/create-cedar-app/src/create-cedar-app.ts`

After extracting `databaseFlag`, add validation:

```ts
if (databaseFlag && databaseFlag !== 'sqlite' && databaseFlag !== 'pglite') {
  tui.stopReactive(true)
  tui.displayError(
    'Invalid database',
    `Unknown database "${databaseFlag}". Supported values: sqlite, pglite`
  )
  recordErrorViaTelemetry('Invalid database flag')
  await shutdownTelemetry()
  process.exit(1)
}

if (databaseFlag === 'pglite' && !useEsm) {
  tui.stopReactive(true)
  tui.displayError(
    'Invalid configuration',
    'The --db pglite flag requires --esm. Use:\n' +
      '  create-cedar-app --esm --db pglite my-app'
  )
  recordErrorViaTelemetry('pglite without esm')
  await shutdownTelemetry()
  process.exit(1)
}
```

Note: `useEsm` is determined by `handleEsmPreference(esmFlag)` which is called
later in the flow. The validation must be placed after the ESM preference is
resolved, or the `esmFlag` must be checked directly (which defaults to `null`
and requires `--esm` to be explicitly passed). Since `--esm` is a hidden flag,
the user must explicitly pass it — there's no interactive prompt. So checking
`parsedFlags.esm` (which is `true` when `--esm` is passed) is sufficient.

Place this validation after `const useEsm = await handleEsmPreference(esmFlag)`
(around line 915):

```ts
// Determine ESM or not
const useEsm = await handleEsmPreference(esmFlag)
trace.getActiveSpan()?.setAttribute('esm', useEsm)

// Validate database flag compatibility
if (databaseFlag === 'pglite' && !useEsm) {
  tui.stopReactive(true)
  tui.displayError(
    'Invalid configuration',
    'The --db pglite flag requires --esm. Use:\n' +
      '  create-cedar-app --esm --db pglite my-app'
  )
  recordErrorViaTelemetry('pglite without esm')
  await shutdownTelemetry()
  process.exit(1)
}
```

---

## Telemetry

Add database tracking to telemetry spans. After the existing
`trace.getActiveSpan()?.setAttribute('esm', useEsm)` line, add:

```ts
trace.getActiveSpan()?.setAttribute('database', databaseFlag ?? 'sqlite')
```

---

## Complete File Change Summary

### Modified files

| File                                                            | Change                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/create-cedar-app/src/create-cedar-app.ts`             | Add `--database`/`--db` yargs option, extract `databaseFlag`, add validation (pglite requires esm), add `database` to `CreateProjectFilesOptions`, add overlay copy logic in `createProjectFiles`, add telemetry |
| `packages/create-cedar-app/templates/ts/gitignore.template`     | Add `api/db/pglite-data` line after `dev.db*`                                                                                                                                                                    |
| `packages/create-cedar-app/templates/js/gitignore.template`     | Same                                                                                                                                                                                                             |
| `packages/create-cedar-app/templates/esm-ts/gitignore.template` | Same                                                                                                                                                                                                             |
| `packages/create-cedar-app/templates/esm-js/gitignore.template` | Same                                                                                                                                                                                                             |

### New files

| File                                                                      | Description                                  |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| `packages/create-cedar-app/database-overlays/pglite/api/db/schema.prisma` | PostgreSQL schema (provider = "postgresql")  |
| `packages/create-cedar-app/database-overlays/pglite/api/src/lib/db.ts`    | PGlite init, socket server, PrismaPg adapter |
| `packages/create-cedar-app/database-overlays/pglite/api/package.json`     | ESM package.json with pglite deps            |
| `packages/create-cedar-app/database-overlays/pglite/.env.defaults`        | PostgreSQL DATABASE_URL                      |

---

## How It Works at Runtime

### Development (`yarn cedar dev`)

1. Cedar's dev process starts the API server via esbuild watch.
2. esbuild compiles `api/src/lib/db.ts` to ESM output (because the project is
   ESM). Top-level await is preserved in the output.
3. Node.js imports the compiled `db.mjs`. The top-level await executes:
   - `PGlite.create('.../api/db/pglite-data')` opens (or creates) the
     PostgreSQL data directory.
   - `PGLiteSocketServer` starts a TCP server on `127.0.0.1:5433`.
4. The PrismaClient is created with a `PrismaPg` adapter pointing at
   `postgresql://postgres:postgres@127.0.0.1:5433/postgres`.
5. Cedar's Fastify server starts and begins serving requests.
6. When a GraphQL query arrives and calls a service function that imports `db`,
   Prisma connects to the PGlite socket server lazily on the first query.

### Creating migrations

```bash
# In a separate terminal, while `yarn cedar dev` is running:
yarn cedar prisma migrate dev --name add_posts
```

Prisma CLI reads `DATABASE_URL` from `.env` (which points at `localhost:5432`
for a real PostgreSQL). If the user wants to run migrations against the PGlite
instance instead, they can temporarily change `DATABASE_URL` to
`postgresql://postgres:postgres@127.0.0.1:5433/postgres`.

Alternatively, the user can use `prisma db push` for prototyping without
creating migration files.

### Production

For production, the user sets `DATABASE_URL` to a real PostgreSQL connection
string. To make this work, `db.ts` needs to be modified to conditionally use
PGlite or the real URL. For example:

```ts
const isDev = process.env.NODE_ENV !== 'production'
const connectionString = isDev
  ? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'
  : process.env.DATABASE_URL

if (isDev) {
  const pgDataDir = path.join(getPaths().api.base, 'db', 'pglite-data')
  const pglite = await PGlite.create(pgDataDir)
  const pgliteServer = new PGLiteSocketServer({
    db: pglite,
    port: 5433,
    host: '127.0.0.1',
  })
  await pgliteServer.start()
}

const adapter = new PrismaPg({ connectionString })
```

This production-ready modification is NOT included in the initial overlay but
should be documented or added as a follow-up.

---

## User-Facing Usage

```bash
# Create a new Cedar app with PGlite (ESM + TypeScript)
yarn create cedar-app --esm --db pglite my-app

# Create with PGlite (ESM + JavaScript)
yarn create cedar-app --esm --ts=false --db pglite my-app

# Create with SQLite (default, unchanged)
yarn create cedar-app my-app
```

The `--db` flag is hidden (not shown in `--help` output) until PGlite support
is considered stable.

---

## Future Considerations

1. **Production conditional**: The initial overlay always initializes PGlite.
   A follow-up should add a `NODE_ENV` check so production uses `DATABASE_URL`
   directly without starting PGlite.

2. **Graceful shutdown**: The reference example handles `SIGINT` to stop the
   PGlite socket server. With module-level init, we don't have a natural place
   for this. Consider adding a process signal handler in db.ts, or defer to a
   future custom server file approach.

3. **Port conflicts**: The PGlite socket server hardcodes port 5433. If
   multiple Cedar apps run simultaneously, they'll conflict. Consider using an
   OS-assigned port (port 0) and storing the actual port somewhere accessible.

4. **Interactive prompt**: If/when `--esm` is unhidden, a database selection
   prompt could be added (similar to the TypeScript/JavaScript prompt).

5. **Prisma v7 compatibility**: The overlay pins `@prisma/adapter-pg` to
   `^7.5.0` to match the existing SQLite adapter version. When Cedar updates
   Prisma, both adapters must be updated together.

6. **Test database**: The SQLite template supports `TEST_DATABASE_URL` for
   test databases. A similar pattern for PGlite (perhaps an in-memory PGlite
   instance for tests) should be considered.

7. **`pglite-data` in version control**: The `api/db/pglite-data` directory
   is gitignored. If a team wants to share a seed database, they'd need to
   use the seed script or a shared migration approach instead.
