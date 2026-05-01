# Plan: Framework Support for Extracting DB Code to a Separate Package

## Context

Cedar currently assumes the Prisma schema, migrations, and generated client all live
under `api/db/`, and that the application's `db` singleton is exported from
`api/src/lib/db.ts`. These paths are hardcoded across the framework: in the codegen
watcher, build pipeline, testing infrastructure, and Babel plugins.

Users want the ability to extract their database layer — schema, migrations, generated
client, and `db` wrapper — into a separate workspace package (e.g. `packages/db`).
This is especially useful in monorepos where a non-Cedar application needs to share
the same database.

The Prisma config path (`api.prismaConfig` in `cedar.toml`) already supports pointing
to an arbitrary location. The missing piece is that the rest of the framework does not
fully respect that config. Instead, it hardcodes `api/db/` or `api/src/lib/db` in
many places.

This plan adds:

1. A new `api.dbModule` config option in `cedar.toml` — a single string that tells
   the framework where to import the user's `db` export from.
2. Proper path derivation from `prismaConfig` everywhere — schema, migrations,
   generated client, and data migrations are all resolved dynamically.
3. A `db` sub-path object added to the framework's `Paths` interface, so downstream
   code stops computing its own Prisma-related paths.

The framework will **not** dictate how the separate DB package is structured. It only
needs to know: (a) where `prisma.config.cjs` lives, and (b) where the `db` export lives.
Everything else follows from the Prisma config file and the schema it points to.

---

## Goals

- A Cedar app can have its entire Prisma layer (schema, migrations, generated client,
  `db` wrapper) in a workspace package outside of `api/`.
- Existing apps with `api/db/` and `api/src/lib/db.ts` require **zero changes**.
- The framework resolves all Prisma file locations from `prisma.config.cjs`, never
  from hardcoded `api/db/` assumptions.
- gqlorm and testing infrastructure use the configurable `dbModule` path instead of
  hardcoded `src/lib/db`.

---

## Non-Goals

- Changing existing codemods. Codemods are version-specific migration tools for apps
  already scaffolded under old conventions. Future codemods should be written against
  the new abstractions, but existing ones do not need retroactive support.
- Dictating the internal structure of the extracted DB package. The user can name
  files and directories however they want inside their package, as long as the
  `prisma.config.cjs` and `dbModule` paths are correct.
- Updating user-owned template files (e.g. `api/src/lib/db.ts`). If a user extracts
  their DB, they are expected to update their own import paths. The framework only
  touches framework-level code.

---

## Changes

### 1. `cedar.toml` config — `api.dbModule`

**File:** `packages/project-config/src/config.ts`

Add `dbModule` to `NodeTargetConfig`:

```ts
export interface NodeTargetConfig {
  // ...existing fields...
  prismaConfig: string
  dbModule: string // <-- new
  serverConfig: string
}
```

Add the default to `DEFAULT_CONFIG`:

```ts
api: {
  // ...existing...
  prismaConfig: './api/prisma.config.cjs',
  dbModule: 'src/lib/db', // <-- new
  serverConfig: './api/server.config.js',
}
```

This default means **existing apps require zero changes**.

For an extracted DB package, a user would write:

```toml
[api]
prismaConfig = './packages/db/prisma.config.cjs'
dbModule = '@myorg/db'
```

The `dbModule` value is treated as a bare module specifier (like an import path).
It can be:

- A relative path like `src/lib/db` (resolved relative to the API side)
- A workspace package name like `@myorg/db`
- Any other path that the app's module resolution understands

---

### 2. Expose derived Prisma paths through `getPaths()`

**File:** `packages/project-config/src/paths.ts`

Add a `db` field to the `Paths` interface:

```ts
export interface Paths {
  // ...existing...
  api: NodeTargetPaths
  db: DbPaths // <-- new
}

export interface DbPaths {
  base: string // directory containing prisma.config.cjs
  prismaConfig: string // absolute path to prisma.config.cjs
  schema: string // absolute path to schema.prisma (or schema dir)
  migrations: string // absolute path to migrations directory
  dataMigrations: string // absolute path to dataMigrations directory
  generatedClient: string | undefined // absolute path to generated client entry
}
```

In `getPaths()`, populate the `db` object by calling the existing utilities from
`packages/project-config/src/prisma.ts`:

- `getDbDir(prismaConfig)` → `db.base`
- `getSchemaPath(prismaConfig)` → `db.schema`
- `getMigrationsPath(prismaConfig)` → `db.migrations`
- `getDataMigrationsPath(prismaConfig)` → `db.dataMigrations`
- `resolveGeneratedPrismaClient()` → `db.generatedClient`

These are async functions, but `getPaths()` is synchronous. Options:

**Option A (recommended):** Make `getPaths()` eagerly call the async utilities and
await them internally, or refactor the utilities to have synchronous variants where
possible (most of them just read a config file and join paths). Alternatively, keep
`db` as an optional/lazily-populated field that callers await separately.

**Option B:** Keep `getPaths()` unchanged and introduce a new async helper
`await getDbPaths()` that consumers call explicitly.

**Decision:** Option B is simpler and avoids making `getPaths()` async, which would
ripple through the entire codebase. Most consumers that need DB paths are already
async (CLI commands, codegen). Callers that need DB paths can use:

```ts
import { getDbPaths } from '@cedarjs/project-config'

const dbPaths = await getDbPaths(getPaths().api.prismaConfig)
```

However, many framework call sites already call the individual async utilities. The
real value of a unified `getDbPaths()` is convenience and discoverability. We will add
`getDbPaths()` as a new exported function in `packages/project-config/src/prisma.ts`.

The existing individual utilities (`getSchemaPath`, `getMigrationsPath`, etc.) remain
unchanged and continue to work.

---

### 3. Fix codegen watcher — stop hardcoding `api/db/`

**File:** `packages/internal/src/generate/watch.ts`

**Current (line 43):**

```ts
const watcher = chokidar.watch(
  ['(web|api)/src/**/*.{ts,js,jsx,tsx}', 'api/db/**/*.prisma']
  // ...
)
```

**Change:** Replace the hardcoded `api/db/**/*.prisma` glob with a dynamically
computed path:

```ts
import { getDbPaths } from '@cedarjs/project-config'

// ...inside the async setup or watch initialization...
const dbPaths = await getDbPaths(getPaths().api.prismaConfig)
const prismaGlob = path.join(dbPaths.base, '**/*.prisma')

const watcher = chokidar.watch(
  ['(web|api)/src/**/*.{ts,js,jsx,tsx}', prismaGlob]
  // ...
)
```

**Current (line 139):**

```ts
} else if (
  absPath.startsWith(path.join(rwjsPaths.base, 'api/db/')) &&
  absPath.endsWith('.prisma')
) {
```

**Change:**

```ts
} else if (
  absPath.startsWith(dbPaths.base) &&
  absPath.endsWith('.prisma')
) {
```

---

### 4. Fix gqlorm Babel plugin — use `dbModule` instead of hardcoded `src/lib/db`

**File:** `packages/babel-config/src/plugins/babel-plugin-cedar-gqlorm-inject.ts`

The plugin currently injects:

```ts
import { db as __gqlorm_db__ } from 'src/lib/db'
```

**Change:** The plugin needs access to the Cedar config to read `dbModule`. The
Babel plugin receives Babel's `api` object, which includes options. The Cedar
Vite plugin (which configures Babel) can pass `dbModule` through Babel's config.

In the Babel plugin:

```ts
// Read dbModule from Babel options (injected by Cedar's Vite/babel setup)
const dbModule =
  state.opts.dbModule ?? state.file.opts.cedarDbModule ?? 'src/lib/db'

// Use dbModule in the injected import
const importDeclaration = t.importDeclaration(
  [t.importSpecifier(t.identifier('db'), t.identifier('__gqlorm_db__'))],
  t.stringLiteral(dbModule)
)
```

The Cedar Vite plugin that configures Babel (`packages/vite/src/plugins/...`) needs
to read `getConfig().api.dbModule` and pass it to the Babel config so the plugin
receives it in `state.opts`.

This is a framework-level change — the user does not touch this code. Once deployed,
all apps (including existing ones) automatically get `dbModule: 'src/lib/db'` as the
fallback, and extracted-DB apps get their configured path injected instead.

---

### 5. Fix testing setup — use `dbModule` for dynamic imports

**Files:**

- `packages/testing/src/api/vitest/vitest-api.setup.ts`
- `packages/testing/src/config/jest/api/jest.setup.ts`

Both files dynamically import `db` from a hardcoded path:

```ts
const libDb = await import(`${cedarPaths.api.lib}/db`)
```

**Change:** Import `getConfig` from `@cedarjs/project-config` and use `dbModule`:

```ts
import { getConfig } from '@cedarjs/project-config'

const dbModule = getConfig().api.dbModule // e.g. 'src/lib/db' or '@myorg/db'

// For relative paths, resolve relative to api base
// For package names, import directly
const db = await import(
  dbModule.startsWith('.') ? path.join(cedarPaths.api.base, dbModule) : dbModule
)
```

The exact resolution logic depends on whether `dbModule` is a relative path or a
package specifier. The simplest robust approach: if it starts with `.` or `/`, resolve
relative to `api.base`. Otherwise, treat it as a bare import and let Node's module
resolution handle it.

---

### 6. Fix `resolveGeneratedPrismaClient` to not assume `api/db/`

**File:** `packages/project-config/src/prisma.ts`

This function already reads the Prisma schema's `generator client { output = "..." }`
block and resolves it. It is already correct in principle. Verify that it does not
fall back to any `api/db/` assumption when `output` is missing or relative.

If the Prisma generator does not specify `output`, Prisma defaults to a location
relative to the schema directory. `resolveGeneratedPrismaClient()` already resolves
relative paths against `schemaRootDir`, which comes from `getPrismaSchemas()`. This
should be correct regardless of where the schema lives.

**Action:** Add a test case where `prisma.config.cjs` lives at
`packages/db/prisma.config.cjs` and verify that `resolveGeneratedPrismaClient()`
returns the correct absolute path.

---

### 7. Audit and fix remaining hardcoded `api/db/` references in framework code

**Files to audit (search for `api/db/` and `api\\/db/` in `packages/`):**

| File                                                      | Issue                                                              | Fix                   |
| --------------------------------------------------------- | ------------------------------------------------------------------ | --------------------- |
| `packages/internal/src/generate/gqlormSchema.ts`          | Hardcoded `api/db/schema.prisma` in generated comment              | Use `getSchemaPath()` |
| `packages/cli/src/lib/generatePrismaClient.ts`            | Passes `--config=${getPaths().api.prismaConfig}` — already correct | Verify                |
| `packages/cli/src/commands/prismaHandler.ts`              | Already uses `getPaths().api.prismaConfig`                         | Verify                |
| `packages/cli/src/commands/build/buildHandler.ts`         | Already uses `getPaths().api.prismaConfig`                         | Verify                |
| `packages/cli/src/commands/experimental/live-queries/...` | Already uses `getPaths().api.prismaConfig`                         | Verify                |
| `packages/cli-packages/dataMigrate/...`                   | Already uses `getPaths().api.prismaConfig`                         | Verify                |

Most CLI commands are already correct. The violations are primarily in:

- Codegen watcher (`watch.ts`)
- Babel plugin (`babel-plugin-cedar-gqlorm-inject.ts`)
- Testing setup (`vitest-api.setup.ts`, `jest.setup.ts`)
- Generated comments in gqlorm (`gqlormSchema.ts`)

**Generators** (`cedar generate scaffold`) should also be audited. They currently
read the schema from the default location. If they use `getSchemaPath()` and
`getDbPaths()`, they should already work with an extracted DB. Verify that:

- `packages/internal/src/generate/graphqlSchema.ts` and related generators do not
  hardcode schema paths.
- `packages/cli/src/commands/generate/` commands resolve schema locations dynamically.

---

### 8. Add tests for extracted DB scenario

**File:** `packages/project-config/src/__tests__/prisma.test.ts`

Add a test case where `prisma.config.cjs` lives outside `api/`:

```ts
it('resolves paths when prisma.config.cjs is in a separate package', async () => {
  const prismaConfigPath = path.join(
    tempDir,
    'packages',
    'db',
    'prisma.config.ts'
  )
  // ...setup mock config and schema...

  const dbDir = await getDbDir(prismaConfigPath)
  expect(dbDir).toBe(path.join(tempDir, 'packages', 'db'))

  const schemaPath = await getSchemaPath(prismaConfigPath)
  expect(schemaPath).toBe(path.join(tempDir, 'packages', 'db', 'schema.prisma'))

  const migrationsPath = await getMigrationsPath(prismaConfigPath)
  expect(migrationsPath).toBe(
    path.join(tempDir, 'packages', 'db', 'migrations')
  )
})
```

**File:** `packages/project-config/src/__tests__/config.test.ts`

Add a test that the default `dbModule` is `'src/lib/db'`:

```ts
it('defaults dbModule to src/lib/db', () => {
  const config = getConfig()
  expect(config.api.dbModule).toBe('src/lib/db')
})
```

**File:** `packages/babel-config/src/__tests__/...` (or create new test)

Add a test for the gqlorm Babel plugin that verifies:

- With default options, it injects `from 'src/lib/db'`
- With `dbModule: '@myorg/db'` passed in state.opts, it injects `from '@myorg/db'`

---

## Acceptance Criteria

- [ ] `api.dbModule` exists in `cedar.toml` config with default `'src/lib/db'`.
- [ ] `getDbPaths()` is exported from `@cedarjs/project-config` and correctly
      resolves all Prisma-related directories from an arbitrary `prismaConfig` path.
- [ ] Codegen watcher (`watch.ts`) watches `.prisma` files at the resolved DB base
      directory, not hardcoded `api/db/`.
- [ ] gqlorm Babel plugin injects imports from `dbModule`, not hardcoded `src/lib/db`.
- [ ] Testing setup (Vitest and Jest) imports `db` from `dbModule`, not hardcoded
      `api/src/lib/db`.
- [ ] All existing tests pass without modification (zero breaking changes).
- [ ] New tests cover the extracted-DB scenario (`prisma.config.cjs` outside `api/`).
- [ ] A manual test confirms: a Cedar app with `prisma.config.cjs` at
      `packages/db/prisma.config.cjs` and `dbModule = '@myorg/db'` can run
      `cedar dev`, `cedar build`, `cedar test`, and `cedar generate scaffold`
      successfully.

---

## Verification Steps

```sh
# Run project-config tests
cd packages/project-config
yarn test

# Run babel-config tests
cd packages/babel-config
yarn test

# Run testing package tests
cd packages/testing
yarn test

# Full test suite from root
yarn test

# Manual verification: create a test project with extracted DB
# (see Acceptance Criteria last item)
```

---

## What This Enables

- Users can extract their entire database layer to a separate workspace package
  (`packages/db`, `@myorg/db`, etc.).
- The same database can be shared with non-Cedar applications in the same monorepo.
- Framework code stops making hardcoded assumptions about `api/db/` and `src/lib/db`.
- Existing Cedar apps require **zero migration work**.
- Future framework features (generators, codemods) are written against dynamic
  path resolution from the start.
