# Upgrade `--live` Flow in `rebuild-test-project-fixture.mts` for Prisma 7

## Background

The `--live` flag in `tasks/test-project/rebuild-test-project-fixture.mts` creates
a test-project fixture that uses PostgreSQL (via `@prisma/dev`'s embedded PGlite)
instead of SQLite. This flow is broken after the migration from Prisma 6 to
Prisma 7 because:

1. The template now generates Prisma 7–style configuration (new generator, driver
   adapters for both SQLite and PostgreSQL, imports from
   `api/db/generated/prisma/client.mts`), but step 7 ("Switch to PostgreSQL") was
   never updated to account for these changes.
2. The existing `__fixtures__/test-project-live` fixture is still stuck on Prisma 6
   conventions (`prisma-client-js` generator, `@prisma/client` imports, no
   `datasource` block in `prisma.config.cjs`).

### What Prisma 7 changed (relevant bits)

| Aspect               | Prisma 6 (old live fixture)              | Prisma 7 (current template)                                     |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Generator provider   | `prisma-client-js`                       | `prisma-client`                                                 |
| Generator output     | implicit (`node_modules/.prisma/client`) | explicit `./generated/prisma`                                   |
| Generator extras     | `binaryTargets = "native"`               | `moduleFormat`, `generatedFileExtension`, `importFileExtension` |
| Import path          | `@prisma/client`                         | `api/db/generated/prisma/client.mts`                            |
| Re-export in `db.ts` | `export * from '@prisma/client'`         | `export * from 'api/db/generated/prisma/client.mts'`            |
| SQLite setup         | Direct `PrismaClient()`                  | `@prisma/adapter-better-sqlite3` driver adapter                 |
| **PostgreSQL setup** | Direct `PrismaClient()`                  | **`@prisma/adapter-pg` driver adapter (required)**              |
| `prisma.config.cjs`  | No `datasource` block                    | `datasource: { url: env('DATABASE_URL') }`                      |

### Key insight from the CedarJS docs (`docs/docs/local-postgres-setup.md`)

The CedarJS documentation on local PostgreSQL setup explicitly states:

> Prisma requires a driver adapter to connect to your database. For PostgreSQL,
> install the `@prisma/adapter-pg` and `pg` packages.

**In Prisma 7, all database providers require a JavaScript driver adapter.** For
SQLite the template uses `@prisma/adapter-better-sqlite3`; for PostgreSQL it must
use `@prisma/adapter-pg`. The old Prisma 6 behaviour of `PrismaClient()` connecting
natively without any adapter no longer applies.

### Key insight from the `prismaV7Prep` codemod

The codemod at `packages/codemods/src/codemods/v2.7.x/prismaV7Prep/` shows the
Prisma 7 convention: all application code should import Prisma types and
`PrismaClient` through `src/lib/db` (not directly from `@prisma/client`), and
`db.ts` re-exports everything from the generated client path.

---

## Current `--live` flow (step 7) — what it does today

```typescript
// 1. Change provider in schema.prisma
projectSchemaPrisma.replace('sqlite', 'postgresql')

// 2. Append DATABASE_URL to .env
'DATABASE_URL=' + localPrisma.ppg.url
```

That is all it does. It does **not** touch `db.ts`, `api/package.json`, or
`prisma.config.cjs`.

---

## Changes Required

### Change 1 — Rewrite `db.ts` for PostgreSQL using `@prisma/adapter-pg`

**File:** `tasks/test-project/rebuild-test-project-fixture.mts`, inside step 7's
`task` callback.

After changing the schema provider to `postgresql`, overwrite
`api/src/lib/db.ts` to swap the SQLite adapter for the PostgreSQL adapter.
The `connectionString` is read from `process.env.DATABASE_URL` at runtime, which
will be set from `.env` (written in the same step).

**Target content for `db.ts`:**

```typescript
// See https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/constructor
// for options.

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
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

**What changed vs the SQLite template `db.ts`:**

| Removed (SQLite)                                                       | Added (PostgreSQL)                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `import path from 'node:path'`                                         | `import { PrismaPg } from '@prisma/adapter-pg'`                |
| `import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'` | (none)                                                         |
| `import { getPaths } from '@cedarjs/project-config'`                   | (none)                                                         |
| `resolveSqliteUrl` helper function                                     | (none)                                                         |
| `new PrismaBetterSqlite3({ url: resolveSqliteUrl(...) })`              | `new PrismaPg({ connectionString: process.env.DATABASE_URL })` |

### Change 2 — Update `api/package.json`: swap SQLite deps for PostgreSQL deps

**File:** `tasks/test-project/rebuild-test-project-fixture.mts`, inside step 7.

After rewriting `db.ts`, read `api/package.json`, swap the SQLite-specific
packages for the PostgreSQL ones, and write it back:

```typescript
const apiPkgPath = path.join(OUTPUT_PROJECT_PATH, 'api', 'package.json')
const apiPkg = JSON.parse(fs.readFileSync(apiPkgPath, 'utf-8'))

delete apiPkg.dependencies['@prisma/adapter-better-sqlite3']
delete apiPkg.dependencies['better-sqlite3']

// pg is the underlying driver used by @prisma/adapter-pg.
// It is also used directly by the live-queries listener, but setup live-queries
// (step 9) adds it too — listing it here makes the intent explicit and ensures
// it is present before any subsequent yarn install.
apiPkg.dependencies['@prisma/adapter-pg'] = '7.5.0' // pin to match prisma version
apiPkg.dependencies['pg'] = '^8.18.0'

fs.writeFileSync(apiPkgPath, JSON.stringify(apiPkg, null, 2) + '\n')
```

> **Note on version pinning:** The `@prisma/adapter-pg` version should match the
> installed `prisma` / `@prisma/client` version used by the project. Inspect
> `api/package.json` after `yarn install` (step 3) to find the exact version in
> use, or read it dynamically from the installed `prisma` version rather than
> hardcoding it.

### Change 3 — Run `yarn install` after `api/package.json` changes

After modifying `api/package.json` in step 7, the lockfile is stale and
`@prisma/adapter-pg` is not yet in `node_modules`. The migrations that run in
step 9 (via `prisma migrate dev`) use the Prisma CLI engine, not the adapter, so
they will succeed regardless. However, the adapter must be present before any
`PrismaClient` is instantiated at runtime, and before the final lint/type-check
passes.

Make step 7's `task` `async` and add a `yarn install` call at the end:

```typescript
task: async () => {
  // ... schema.prisma, db.ts, package.json changes ...

  await exec('yarn install', [], getExecaOptions(OUTPUT_PROJECT_PATH))
},
```

### Change 4 — Update the `DATABASE_URL` source property

**File:** `tasks/test-project/rebuild-test-project-fixture.mts`, inside step 7.

The current code uses `localPrisma.ppg.url`. The `@prisma/dev@0.24.1` API
exposes several URL properties on the `ProgrammaticServer` (which extends
`Exports`):

| Property                             | Purpose                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `database.connectionString`          | Standard `postgresql://` connection string (port 51214 by default)        |
| `database.prismaORMConnectionString` | Optional Prisma ORM–specific connection string (may include extra params) |
| `ppg.url`                            | Prisma Postgres Gateway URL                                               |

**Recommended approach:**

```typescript
const databaseUrl =
  localPrisma.database.prismaORMConnectionString ??
  localPrisma.database.connectionString
```

This prefers the Prisma ORM–specific string when available, falling back to the
standard connection string. Both produce a valid `postgresql://` URL suitable for
`process.env.DATABASE_URL` (consumed by `@prisma/adapter-pg` at runtime) and for
`env('DATABASE_URL')` in `prisma.config.cjs` (consumed by the Prisma CLI).

If `ppg.url` turns out to still be an equivalent value (verify during
implementation), it is acceptable to keep using it; but `database.connectionString`
is the semantically correct property to use here.

If there are connection issues with `database.prismaORMConnectionString` or
`database.connectionString`, use `ppg.url`.

### Change 5 — Make the `provider` swap more targeted

**File:** `tasks/test-project/rebuild-test-project-fixture.mts`, inside step 7.

The current replacement `projectSchemaPrisma.replace('sqlite', 'postgresql')`
is a naive string replace that would break if `"sqlite"` appeared in a comment or
elsewhere in the file.

**Recommended improvement:**

```typescript
fs.writeFileSync(
  projectSchemaPath,
  projectSchemaPrisma.replace(
    /provider\s+=\s+"sqlite"/,
    'provider = "postgresql"'
  )
)
```

This is unambiguous and matches exactly the pattern in the Prisma 7 template's
`schema.prisma`.

### Change 6 — Verify `prisma.config.cjs` is correct (no code change needed)

The template's `prisma.config.cjs` already contains:

```javascript
datasource: {
  url: env('DATABASE_URL'),
},
```

Since step 7 writes `DATABASE_URL=<pg_url>` to `.env`, and `.env` takes
precedence over `.env.defaults` (which has `DATABASE_URL=file:./db/dev.db`),
the PostgreSQL URL will be used correctly by the Prisma CLI. **No change is
needed here.**

---

## Summary of changes to step 7

Here is the complete revised step 7 task function:

```typescript
await tuiTask({
  step: 7,
  title: (!live ? 'skip: ' : '') + 'Switch to PostgreSQL',
  task: async () => {
    if (!live || !localPrisma) {
      return
    }

    // 1. Change datasource provider from sqlite to postgresql
    const projectSchemaPath = path.join(
      OUTPUT_PROJECT_PATH,
      'api',
      'db',
      'schema.prisma'
    )
    const projectSchemaPrisma = fs.readFileSync(projectSchemaPath, 'utf-8')
    fs.writeFileSync(
      projectSchemaPath,
      projectSchemaPrisma.replace(
        'provider = "sqlite"',
        'provider = "postgresql"'
      )
    )

    // 2. Rewrite db.ts — swap SQLite adapter for PostgreSQL adapter
    const dbPath = path.join(OUTPUT_PROJECT_PATH, 'api', 'src', 'lib', 'db.ts')
    fs.writeFileSync(
      dbPath,
      [
        '// See https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/constructor',
        '// for options.',
        '',
        "import { PrismaPg } from '@prisma/adapter-pg'",
        "import { PrismaClient } from 'api/db/generated/prisma/client.mts'",
        '',
        "import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'",
        '',
        "import { logger } from './logger.js'",
        '',
        "export * from 'api/db/generated/prisma/client.mts'",
        '',
        'const adapter = new PrismaPg({',
        '  connectionString: process.env.DATABASE_URL,',
        '})',
        '',
        'const prismaClient = new PrismaClient({',
        "  log: emitLogLevels(['info', 'warn', 'error']),",
        '  adapter,',
        '})',
        '',
        'handlePrismaLogging({',
        '  db: prismaClient,',
        '  logger,',
        "  logLevels: ['info', 'warn', 'error'],",
        '})',
        '',
        '/**',
        ' * Global Prisma client extensions should be added here, as $extend',
        ' * returns a new instance.',
        ' * export const db = prismaClient.$extend(...)',
        ' * Add any .$on hooks before using $extend',
        ' */',
        'export const db = prismaClient',
        '',
      ].join('\n')
    )

    // 3. Swap SQLite deps for PostgreSQL deps in api/package.json
    const apiPkgPath = path.join(OUTPUT_PROJECT_PATH, 'api', 'package.json')
    const apiPkg = JSON.parse(fs.readFileSync(apiPkgPath, 'utf-8'))
    delete apiPkg.dependencies['@prisma/adapter-better-sqlite3']
    delete apiPkg.dependencies['better-sqlite3']
    // Read the prisma version already installed to keep adapter versions in sync
    const prismaVersion = apiPkg.dependencies['prisma'] ?? '7.5.0'
    apiPkg.dependencies['@prisma/adapter-pg'] = prismaVersion
    apiPkg.dependencies['pg'] = '^8.18.0'
    fs.writeFileSync(apiPkgPath, JSON.stringify(apiPkg, null, 2) + '\n')

    // 4. Set DATABASE_URL to the @prisma/dev database connection string
    const databaseUrl =
      localPrisma.database.prismaORMConnectionString ??
      localPrisma.database.connectionString
    const projectEnvPath = path.join(OUTPUT_PROJECT_PATH, '.env')
    const projectEnv = fs.readFileSync(projectEnvPath, 'utf-8')
    fs.writeFileSync(
      projectEnvPath,
      projectEnv + '\n\n' + 'DATABASE_URL=' + databaseUrl
    )

    // 5. Re-install so @prisma/adapter-pg is available in node_modules
    await exec('yarn install', [], getExecaOptions(OUTPUT_PROJECT_PATH))
  },
})
```

---

## Other steps that may need attention

### Step 6: "Prep for env var tests"

This step modifies `prisma.config.cjs` by looking for the string
`module.exports = defineConfig({`. The current template produces exactly this
string, so **no change is needed**.

### Step 9: "Apply api codemods"

The api tasks list includes a final task "Set up support for live queries"
that runs `yarn cedar setup realtime --no-examples` and
`yarn cedar setup live-queries`. The live-queries handler:

- Checks that the provider is PostgreSQL ✅ (we changed it in step 7)
- Adds `pg@^8.18.0` to api deps — this will be a no-op since step 7 already
  adds `pg` ✅
- Creates the LISTEN/NOTIFY migration ✅
- Creates `api/src/lib/liveQueriesListener.ts` ✅
- Wires listener into the GraphQL handler ✅

**No changes needed** — this should work correctly once step 7 properly sets up
PostgreSQL.

### Step 12: "Running prisma migrate reset"

Runs `yarn cedar prisma migrate reset --force`. This will work as long as
`DATABASE_URL` points to the running `@prisma/dev` PGlite instance. The
`@prisma/dev` server handles the shadow database automatically (on port 51215 by
default).

#### Prisma client generation — already handled before step 12

The Prisma client does **not** need to be generated as a separate step before
`migrate reset`. Here is why:

- Step 9 (`apiTasksList`) runs its very first sub-task — _"Adding post and user
  model to prisma"_ — which executes `yarn cedar prisma migrate dev --name
create_post_user`.
- In Prisma 7, `migrate dev` automatically calls `prisma generate` after
  applying migrations and writes the client to the custom output path
  (`api/db/generated/prisma/`) declared in the generator block that step 7
  adds to `schema.prisma`.
- By the time step 10 runs `yarn cedar build --no-prerender`, the generated
  client already exists, so the build succeeds.
- Step 12's `migrate reset` then resets the database, reapplies every
  migration (including the LISTEN/NOTIFY one from `setup live-queries`), and
  regenerates the client a second time. This is redundant but harmless.

**No changes needed** for client generation.

#### `db seed` — Prisma 7 removed auto-seeding from `migrate reset`

Prisma 7 no longer runs `prisma db seed` automatically after `migrate reset`
(it was opt-in via the `seed` key in `package.json` in Prisma 6, but Prisma 7
dropped the automatic invocation entirely).

For this fixture-rebuild flow that change has **no impact**:

- Nothing between step 12 and step 14 reads data from the database.
- Step 11 (which runs _before_ `migrate reset`) only verifies that `seed`
  appears in the output of `yarn cedar exec` — i.e., that the seed _file_
  exists — it never executes it.
- Step 14 removes `dev.db` / `dev.db-journal` and `.env` regardless, so
  database state is not preserved in the fixture.

**No changes needed** for seeding in `rebuild-test-project-fixture.mts`.

> **Note for other flows:** `test-project.mts` also calls `prisma migrate
reset --force`. If any Playwright or integration tests run against that
> project and rely on the database having been seeded by `migrate reset`, an
> explicit `yarn cedar prisma db seed` call must be added after `migrate
reset` in that file. `fragments-tasks.mts` already follows this pattern
> (it calls `yarn cedar prisma db seed` explicitly), so the precedent exists.

### Step 14: "Replace and Cleanup Fixture"

Already removes `.env` (which contains the local `DATABASE_URL`).
**No changes needed.**

---

## Testing plan

1. **Build the framework:** `yarn build`
2. **Run the live rebuild:** `yarn rebuild-test-project --live`
3. **Verify the generated fixture:**
   - `api/db/schema.prisma` has `provider = "postgresql"` and the Prisma 7
     generator block (`provider = "prisma-client"` with `output`, `moduleFormat`,
     etc.)
   - `api/src/lib/db.ts` uses `@prisma/adapter-pg` / `PrismaPg`, imports from
     `api/db/generated/prisma/client.mts`, has no SQLite-specific code
   - `api/package.json` contains `@prisma/adapter-pg` and `pg`, and does **not**
     contain `@prisma/adapter-better-sqlite3` or `better-sqlite3`
   - `api/prisma.config.cjs` has the `datasource: { url: env('DATABASE_URL') }`
     block
4. **Verify migrations ran:** The migration folders should exist in
   `api/db/migrations/`
5. **Verify the fixture replaces `__fixtures__/test-project-live` correctly**

---

## Risk assessment

| Risk                                                                 | Likelihood | Mitigation                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.prismaORMConnectionString` is `undefined`                  | Low        | Fall back to `database.connectionString`; can also keep `ppg.url` as a last resort after verifying its format                                                             |
| Shadow database not auto-discovered by Prisma CLI                    | Low        | `@prisma/dev` manages this internally via its HTTP server; if needed, set `SHADOW_DATABASE_URL` from `localPrisma.shadowDatabase.connectionString` in `prisma.config.cjs` |
| `@prisma/adapter-pg` version mismatch with installed `prisma`        | Low        | Read the version dynamically from the installed `prisma` package in `api/package.json` rather than hardcoding it                                                          |
| `yarn install` after dep swap causes unexpected issues               | Low        | Only deps are being swapped (not added without removal); lockfile update should be routine                                                                                |
| `setup live-queries` fails because `pg` is already in `package.json` | Very low   | The `setup live-queries` handler already has a `hasPgDependency` check and skips adding `pg` if present                                                                   |
