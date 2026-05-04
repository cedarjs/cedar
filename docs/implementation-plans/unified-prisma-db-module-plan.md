# Unified Plan: Configurable Prisma Client Module & Extracted DB Package Support

## Table of Contents

- [Overview](#overview)
- [Goals](#goals)
- [Non-Goals](#non-goals)
- [Architecture Decisions](#architecture-decisions)
- [Config Changes](#config-changes)
- [Path Resolution Infrastructure](#path-resolution-infrastructure)
- [Runtime Infrastructure Changes](#runtime-infrastructure-changes)
- [Code Generator Changes](#code-generator-changes)
- [Template Changes](#template-changes)
- [Setup Command Changes](#setup-command-changes)
- [Codemod Changes](#codemod-changes)
- [Complete File Change Summary](#complete-file-change-summary)
- [How It Works at Runtime](#how-it-works-at-runtime)
- [User-Facing Usage](#user-facing-usage)
- [Acceptance Criteria](#acceptance-criteria)
- [Verification Steps](#verification-steps)
- [Future Considerations](#future-considerations)

---

## Overview

Allow Cedar users to configure the module path from which the framework imports
the Prisma client singleton (`db`) and resolve all Prisma-related file locations
(schema, migrations, generated client) dynamically from `prisma.config.cjs`.
Today these paths are hardcoded as `src/lib/db` and `api/db/` across ~30 files
in generators, Babel plugins, testing infrastructure, the codegen watcher, and
templates. This change makes the `db` module path configurable via `cedar.toml`
and exposes derived Prisma paths through a unified `getDbPaths()` helper,
enabling users to extract their entire Prisma layer into a shared monorepo
package (e.g. `packages/db/` or `@scope/db`) that multiple workspaces can
depend on — including non-Cedar apps.

---

## Goals

- A Cedar app can have its entire Prisma layer (schema, migrations, generated
  client, `db` wrapper) in a workspace package outside of `api/`.
- Existing apps with `api/db/` and `api/src/lib/db.ts` require **zero changes**.
- The framework resolves all Prisma file locations from `prisma.config.cjs`,
  never from hardcoded `api/db/` assumptions.
- gqlorm and testing infrastructure use the configurable `dbModule` path
  instead of hardcoded `src/lib/db`.
- Framework code stops making hardcoded assumptions about `api/db/` and
  `src/lib/db`.

---

## Non-Goals

- Changing existing codemods. Codemods are version-specific migration tools
  for apps already scaffolded under old conventions. Future codemods should
  be written against the new abstractions, but existing ones do not need
  retroactive support.
- Dictating the internal structure of the extracted DB package. The user can
  name files and directories however they want inside their package, as long
  as the `prisma.config.cjs` and `dbModule` paths are correct.
- Updating user-owned template files (e.g. `api/src/lib/db.ts`). If a user
  extracts their DB, they are expected to update their own import paths. The
  framework only touches framework-level code.

---

## Architecture Decisions

**Decision 1: Single config key in `cedar.toml` (`[api].dbModule`)**

A single key controls the import source for the Prisma client singleton.
Default: `"src/lib/db"`. Users set it to a bare package specifier like
`"@scope/db"` to point at a shared workspace package. All generators, Babel
plugins, testing infrastructure, and templates read from this one value.

**Decision 2: Support bare specifiers, `src/` paths, and relative paths**

The `dbModule` value is resolved using a unified strategy based on its prefix:

| Prefix          | Example                      | Resolution                                                                    |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `src/`          | `src/lib/db`                 | Resolve to `api.src + '/lib/db'` (uses existing `src/` Vite/Babel/Jest alias) |
| `./` or `../`   | `./packages/db/src/index`    | Resolve relative to `api.base` (the api workspace root)                       |
| begins with `/` | `/absolute/path/db`          | Use as-is (absolute path)                                                     |
| everything else | `@scope/db`, `my-db-package` | Bare specifier — pass directly into `import` statements                       |

This preserves backward compatibility (the default `src/lib/db` matches the
first case) while also supporting extracted packages and arbitrary filesystem
paths.

**Decision 3: `$api` alias in web-side types gets special handling**

The web-side type generation in `graphqlCodeGen.ts` currently generates
`import { Prisma } from "$api/src/lib/db"`. The `$api` prefix is a web-side
Vite alias that resolves to the api workspace. When `dbModule` is set to a
bare package specifier (e.g. `@scope/db`), the `$api` wrapper is unnecessary —
the web workspace can import directly from the shared package. The codegen
must detect this case and omit the `$api` prefix.

**Decision 4: Async `getDbPaths()` helper (non-blocking `getPaths()`)**

Rather than making the synchronous `getPaths()` async (which would ripple
through the entire codebase), introduce a new async helper `getDbPaths()`
that consumers call explicitly. Most callers that need DB paths are already
async (CLI commands, codegen). The existing individual utilities
(`getSchemaPath`, `getMigrationsPath`, etc.) remain unchanged.

**Decision 5: Babel plugin receives `dbModule` via options**

The Babel plugin receives `dbModule` through Babel's options object, injected
by Cedar's Vite/babel setup. This is cleaner than requiring `@cedarjs/project-config`
inside the plugin itself. The plugin falls back to `'src/lib/db'` if no option
is provided.

**Decision 6: Codemods stay pinned to the default convention (de-scoped)**

The `v2.7.x` and `v3.x` Prisma codemods that rewrite imports through
`src/lib/db` are migration tools for existing projects. Users who change
`dbModule` are self-selecting for a non-default setup and are responsible for
their own import paths. Updating codemods for this edge case adds complexity
without meaningful value.

---

## Config Changes

### `packages/project-config/src/config.ts`

Add `dbModule` to `NodeTargetConfig`:

```typescript
export interface NodeTargetConfig {
  // ...existing fields...
  prismaConfig: string
  dbModule: string // <-- new
  serverConfig: string
}
```

Add the default to `DEFAULT_CONFIG`:

```typescript
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

---

## Path Resolution Infrastructure

### `packages/project-config/src/prisma.ts`

Add a new exported async function `getDbPaths()`:

```typescript
export interface DbPaths {
  base: string // directory containing prisma.config.cjs
  prismaConfig: string // absolute path to prisma.config.cjs
  schema: string // absolute path to schema.prisma (or schema dir)
  migrations: string // absolute path to migrations directory
  dataMigrations: string // absolute path to dataMigrations directory
  generatedClient: string | undefined // absolute path to generated client entry
}

export async function getDbPaths(prismaConfigPath: string): Promise<DbPaths> {
  return {
    base: await getDbDir(prismaConfigPath),
    prismaConfig: prismaConfigPath,
    schema: await getSchemaPath(prismaConfigPath),
    migrations: await getMigrationsPath(prismaConfigPath),
    dataMigrations: await getDataMigrationsPath(prismaConfigPath),
    generatedClient: await resolveGeneratedPrismaClient(prismaConfigPath),
  }
}
```

The existing individual utilities (`getSchemaPath`, `getMigrationsPath`, etc.)
remain unchanged and continue to work.

### `packages/project-config/src/paths.ts`

Add a helper to resolve the db module identifier:

```typescript
// Returns the configured import source for the Prisma client singleton.
// For bare specifiers (e.g. "@scope/db"), returns the specifier as-is.
// For relative paths (e.g. "src/lib/db"), returns the path relative to
// the api src directory (so the existing "src/" Vite/Babel alias works).
export function getPrismaClientModule(): string {
  const module = getConfig(getConfigPath(BASE_DIR)).api.dbModule
  return module
}

// Resolves a dbModule value to an absolute path or returns the bare specifier.
export function resolveDbModule(
  module: string,
  apiSrc: string,
  apiBase: string
): string {
  if (module.startsWith('src/')) {
    return path.join(apiSrc, module.replace('src/', ''))
  }
  if (
    module.startsWith('./') ||
    module.startsWith('../') ||
    module.startsWith('/')
  ) {
    return path.resolve(apiBase, module)
  }
  return module // bare specifier
}
```

---

## Runtime Infrastructure Changes

These are blocking — the app will not work without them when
`dbModule` is changed.

### 1. `packages/babel-config/src/plugins/babel-plugin-cedar-gqlorm-inject.ts`

**Line 153** — Hardcodes:

```js
t.stringLiteral('src/lib/db')
```

**Change:** Read `dbModule` from Babel options (injected by Cedar's Vite/babel
setup):

```ts
// Read dbModule from Babel options (injected by Cedar's Vite/babel setup)
const dbModule =
  state.opts.dbModule ?? state.file.opts.cedarDbModule ?? 'src/lib/db'

// Use dbModule in the injected import
// t.importSpecifier(local, imported) — local is the name used in this file,
// imported is the name exported from the target module.
// This produces: import { db as __gqlorm_db__ } from '<dbModule>'
const importDeclaration = t.importDeclaration(
  [t.importSpecifier(t.identifier('__gqlorm_db__'), t.identifier('db'))],
  t.stringLiteral(dbModule)
)
```

The Cedar Vite plugin that configures Babel needs to read
`getConfig().api.dbModule` and pass it to the Babel config so the plugin
receives it in `state.opts`.

This is the most architecturally significant change. The Babel plugin injects
`import { db as __gqlorm_db__ } from '<module>'` into the compiled
`api/src/functions/graphql.ts` at build time. If the module path is wrong,
gqlorm live queries will break.

### 2. `packages/internal/src/generate/watch.ts`

**Line 43** — Hardcoded glob:

```ts
const watcher = chokidar.watch(
  ['(web|api)/src/**/*.{ts,js,jsx,tsx}', 'api/db/**/*.prisma']
  // ...
)
```

**Change:** Replace with dynamically computed path:

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

**Line 139** — Hardcoded path check:

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

### 3. `packages/testing/src/api/vitest/vite-plugin-track-db-imports.ts`

**Line 10** — Hardcoded regex:

```js
id.match(/\/api\/src\/lib\/db\.(js|ts)$/)
```

**Change:** When `dbModule` is a bare specifier (e.g. `@scope/db`),
this regex won't match. The plugin needs to either:

- Build a pattern that matches the configured module name (for bare specifiers,
  match `node_modules/@scope/db/index.{js,ts}` or the resolved Vite path).
- Or broaden the detection to use a different mechanism — e.g., look for the
  Vite-resolved module ID rather than the file-system path.

### 4. `packages/testing/src/api/vitest/vitest-api.setup.ts`

**Line 357:**

```js
const libDb = await import(`${cedarPaths.api.lib}/db`)
```

**Change:** Use the configured module path with unified resolution:

```js
import { getPrismaClientModule, resolveDbModule } from '@cedarjs/project-config'

const prismaModule = getPrismaClientModule()
const libDb = await import(
  resolveDbModule(prismaModule, cedarPaths.api.src, cedarPaths.api.base)
)
```

### 5. `packages/testing/src/config/jest/api/jest.setup.ts`

**Line 134:**

```js
const { db } = await import(`${apiSrcPath}/lib/db`)
```

**Line 306:**

```js
const libDbPath = require.resolve(`${apiSrcPath}/lib/db`)
```

**Change:** Same unified resolution pattern as item 4. Both the
`import()` at line 134 and `require.resolve()` at line 306 must use the
`resolveDbModule()` helper to handle `src/` paths, relative paths, and bare
specifiers correctly.

### 6. `packages/testing/src/config/jest/api/jest-preset.ts`

**Line 49** — Jest `moduleNameMapper`:

```js
'^src/(.*)$': path.join(rwjsPaths.api.src, '$1')
```

**Change:** If `dbModule` is a bare specifier, the Jest config needs
a module mapper entry for that package to resolve it correctly (e.g., map
`@scope/db` to the workspace package's source). If it's still a `src/` path,
the existing mapper handles it.

### 7. `packages/testing/src/api/vitest/vite-plugin-cedar-vitest-api-config.ts`

**Line 18:**

```js
src: getPaths().api.src
```

**Change:** If `dbModule` is a bare specifier, add an additional
Vite resolve alias mapping the package name to its source directory.

### 8. `packages/internal/src/generate/gqlormSchema.ts`

Hardcoded `api/db/schema.prisma` in generated comment.

**Change:** Use `getSchemaPath()` to derive the schema path dynamically.

---

## Code Generator Changes

These generate user-facing code with wrong import paths when
`dbModule` is changed.

### 9. `packages/cli/src/commands/generate/service/serviceHandler.js`

**Line 313:**

```js
const prismaImportSource = 'src/lib/db'
```

**Change:** Read from project config:

```js
const { getPrismaClientModule } = require('@cedarjs/project-config')
const prismaImportSource = getPrismaClientModule()
```

This variable is passed to three templates (serviceFile, testFile,
scenariosFile).

### 10. `packages/cli/src/commands/generate/service/templates/service.ts.template`

**Line 3** — Hardcoded (not using the template variable):

```
import { db } from 'src/lib/db'
```

**Change:** Use the template variable `${prismaImportSource}` consistently:

```
import { db } from '${prismaImportSource}'
```

### 11. `packages/cli/src/commands/generate/service/templates/test.ts.template`

**Line 34:**

```
import { Prisma, Model } from '${prismaImportSource}'
```

**Change:** No template change needed — already uses `${prismaImportSource}`.
The fix in `serviceHandler.js` (item 9) flows through.

### 12. `packages/cli/src/commands/generate/service/templates/scenarios.ts.template`

**Lines 1-3:**

```
import type { Prisma, ${prismaModel} } from '${prismaImportSource}'
```

**Change:** No template change needed — already uses `${prismaImportSource}`.

### 13. `packages/cli/src/commands/generate/dataMigration/dataMigration.js`

**Line 50:**

```js
const prismaImportSource = 'src/lib/db'
```

**Change:** Read from project config (same pattern as item 9).

### 14. `packages/cli/src/commands/generate/dataMigration/templates/dataMigration.ts.template`

**Line 1:**

```
import type { PrismaClient } from '${prismaImportSource}'
```

**Change:** No template change needed.

### 15. `packages/cli/src/commands/generate/dataMigration/templates/dataMigration.js.template`

**Line 2:**

```
@param {{db: PrismaClient}} db
```

**Change:** No template change needed (JSDoc type comes from the template
variable indirectly).

### 16. `packages/internal/src/generate/graphqlCodeGen.ts`

**Line 74:**

```ts
const prismaImportSource = 'src/lib/db'
```

**Line 145:**

```ts
content: `import { Prisma } from "$api/src/lib/db"`
```

**Change:** Both need config awareness. The web-side generation (line 145) is
the tricky one:

```ts
const prismaImportSource = getPrismaClientModule()
// api/types/graphql.d.ts
// Use the dbModule value directly — api-side resolution (Vite/Babel alias)
// handles src/ paths and bare specifiers alike.
// → `import { Prisma } from "${prismaImportSource}"`

// web/types/graphql.d.ts
// The web side uses the $api/ Vite alias to reach into the api workspace.
// Bare specifiers (e.g. "@scope/db") don't need $api/ — the web workspace
// can import from the shared package directly.
// src/ and relative paths DO need $api/ wrapping.
function isBareSpecifier(module) {
  return (
    !module.startsWith('src/') &&
    !module.startsWith('./') &&
    !module.startsWith('../') &&
    !module.startsWith('/')
  )
}
const webImportSource = isBareSpecifier(prismaImportSource)
  ? prismaImportSource
  : `$api/${prismaImportSource}`
// → `import { Prisma } from "${webImportSource}"`
```

### 17. `packages/record/src/tasks/parse.js`

**Line 16:**

```js
"import { db } from 'src/lib/db'",
```

**Change:** Read from project config:

```js
const { getPrismaClientModule } = require('@cedarjs/project-config')
// ...
`import { db } from '${getPrismaClientModule()}'`,
```

---

## Template Changes

These are the files copied into newly created Cedar projects by
`create-cedar-app`. They define what the `db` export is and how seed scripts
import it.

### 18-21. `packages/create-cedar-app/templates/*/scripts/seed.{ts,js}` (4 files)

All four have a commented-out import:

```ts
// import { db } from 'api/src/lib/db.js'
```

**Change:** These are template files in a new project that won't know about
`cedar.toml` config at template-creation time. Options:

1. **Keep as-is** — these are comments, not functional code. Users uncomment
   and edit as needed.
2. **Update to a placeholder comment** — e.g.
   `// import { db } from '<your prisma client module>'`

Recommendation: Option 1 (no change). These are scaffolding hints, not
functional code.

### 22-27. `packages/create-cedar-app/templates/*/api/src/lib/db.{ts,js}` (4 files + 2 database overlays)

These are the actual `db.ts`/`db.js` files that instantiate and export the
Prisma client.

**Change:** No template changes needed. These files define the `db` export.
When a user changes `dbModule` to a shared package, they would:

1. Move this file to `packages/db/src/index.ts` in the shared package.
2. Delete it from `api/src/lib/db.ts`.
3. Set `dbModule = "@scope/db"` in `cedar.toml`.

The framework doesn't need to generate different templates — the user
controls this manually.

---

## Setup Command Changes

### 28. `packages/cli/src/commands/setup/uploads/uploadsHandler.js`

**Line 89-91:**

```js
const dbPath = path.join(getPaths().api.lib, `db.${ext}`)
```

**Change:** Resolve the db file path from the configured module. If it's a
bare specifier, the file doesn't live in `api/src/lib/` at all — it lives in
the workspace package. The setup command needs to:

- Detect if `dbModule` is a bare specifier → find the package source
  file via workspace resolution (`require.resolve` or `readPackageUp`).
- If it's a `src/` path → maintain current behavior.

### 29. `packages/cli/src/lib/exec.js`

**Line 142:**

```js
path.join(getPaths().api.lib, 'db')
```

**Change:** Resolve from config. The exec runner disconnects the Prisma client
after script execution. It needs to `import()` the module from the configured
path (or `require.resolve` it) rather than assuming `api/src/lib/db`.

---

## Codemod Changes

### 30-36. `packages/codemods/src/codemods/v3.x/prismaV7/` and `v2.7.x/prismaV7Prep/` (~7 files)

**Decision:** De-scoped. These Prisma migration codemods assume the default
convention (`src/lib/db` / `api/src/lib/db`). Users who customize
`dbModule` are responsible for their own import paths. No changes
needed.

---

## Complete File Change Summary

### Additions (2 files)

- New config key `dbModule` in `packages/project-config/src/config.ts`
- New `getDbPaths()` async helper in `packages/project-config/src/prisma.ts`

### Modifications (16 files)

| #   | File                                                                       | Effort | Notes                                               |
| --- | -------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| 1   | `packages/project-config/src/paths.ts`                                     | Small  | Add `getPrismaClientModule()` + `resolveDbModule()` |
| 2   | `packages/babel-config/src/plugins/babel-plugin-cedar-gqlorm-inject.ts`    | Medium | Read dbModule from Babel options                    |
| 3   | `packages/internal/src/generate/watch.ts`                                  | Medium | Dynamic prisma glob from `getDbPaths()`             |
| 4   | `packages/testing/src/api/vitest/vite-plugin-track-db-imports.ts`          | Medium | Make regex/module detection config-aware            |
| 5   | `packages/testing/src/api/vitest/vitest-api.setup.ts`                      | Small  | Dynamic import from configured module               |
| 6   | `packages/testing/src/config/jest/api/jest.setup.ts`                       | Small  | Two dynamic import sites                            |
| 7   | `packages/testing/src/config/jest/api/jest-preset.ts`                      | Small  | Module mapper for custom paths                      |
| 8   | `packages/testing/src/api/vitest/vite-plugin-cedar-vitest-api-config.ts`   | Small  | Alias for bare specifiers                           |
| 9   | `packages/internal/src/generate/gqlormSchema.ts`                           | Small  | Use `getSchemaPath()` in generated comment          |
| 10  | `packages/cli/src/commands/generate/service/serviceHandler.js`             | Small  | `prismaImportSource` from config                    |
| 11  | `packages/cli/src/commands/generate/service/templates/service.ts.template` | Small  | Use `${prismaImportSource}`                         |
| 12  | `packages/cli/src/commands/generate/dataMigration/dataMigration.js`        | Small  | `prismaImportSource` from config                    |
| 13  | `packages/internal/src/generate/graphqlCodeGen.ts`                         | Medium | API + web type gen, `$api` handling                 |
| 14  | `packages/record/src/tasks/parse.js`                                       | Small  | `dbModule` from config                              |
| 15  | `packages/cli/src/commands/setup/uploads/uploadsHandler.js`                | Medium | Resolve db file path from module                    |
| 16  | `packages/cli/src/lib/exec.js`                                             | Small  | Resolve from config                                 |

### No Changes (de-scoped)

- All `create-cedar-app` template files (db.ts/db.js, seed scripts)
- All codemod packages (v2.7.x, v3.x Prisma migrations)
- Database overlay files (pglite, neon-postgres)
- Test fixtures in `__fixtures__/`

---

## How It Works at Runtime

### Default (no change to `cedar.toml`)

`dbModule` defaults to `"src/lib/db"`. All existing behavior is
preserved. The framework resolves `src/` imports via the Vite/Babel `src`
alias pointing to `api/src/`. Zero behavioral change for existing projects.

### Shared package mode

```toml
# cedar.toml
[api]
  dbModule = "@my-scope/db"
  prismaConfig = "./packages/db/prisma.config.cjs"
```

```json
// api/package.json
{
  "dependencies": {
    "@my-scope/db": "workspace:*"
  }
}
```

```json
// packages/db/package.json
{
  "name": "@my-scope/db",
  "main": "./src/index.ts",
  "dependencies": {
    "@prisma/client": "^7.0.0"
  }
}
```

```
packages/db/
  src/
    index.ts       ← exports { db, PrismaClient, model types }
  schema.prisma
  migrations/
  prisma.config.cjs
```

```ts
// packages/db/src/index.ts
import { PrismaClient } from '@prisma/client'
export * from '@prisma/client'

const prismaClient = new PrismaClient()
export const db = prismaClient
```

What changes:

1. **Services** — `import { db } from '@my-scope/db'` (generated by CLI)
2. **GraphQL codegen** — `import { Prisma } from '@my-scope/db'`
3. **Gqlorm inject** — `import { db as __gqlorm_db__ } from '@my-scope/db'`
4. **Testing** — dynamically imports `@my-scope/db` instead of `api/src/lib/db`
5. **Codegen watcher** — watches `packages/db/**/*.prisma` instead of `api/db/**/*.prisma`
6. **Non-Cedar app** — `import { db } from '@my-scope/db'` works directly

### Partial extraction (just the Prisma client singleton)

If the user only extracts the `db` module but keeps the Prisma schema and
migrations in `api/db/`, they can set:

```toml
dbModule = "@my-scope/db"
```

And point `prismaConfig` to the existing location:

```toml
[api]
  prismaConfig = "./api/prisma.config.cjs"
```

This separates the client instantiation from the schema management — both are
already independently configurable.

---

## User-Facing Usage

### Setup

```bash
# Existing workspace packages are supported (Cedar reads package.json workspaces)
mkdir packages/db
# ... create package.json, schema.prisma, prisma.config.cjs, src/index.ts

# Update cedar.toml
#   [api]
#     dbModule = "@my-scope/db"
#     prismaConfig = "./packages/db/prisma.config.cjs"

# Remove the old db file
rm api/src/lib/db.ts

# Regenerate
yarn cedar prisma generate
yarn cedar generate types
```

### Generators still work

```bash
yarn cedar generate scaffold Post
# → api/src/services/posts/posts.ts imports db from '@my-scope/db'
# → api/types/graphql.d.ts imports Prisma from '@my-scope/db'
# → web/types/graphql.d.ts imports Prisma from '@my-scope/db'
```

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

## Testing Strategy

### `packages/project-config/src/__tests__/prisma.test.ts`

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

### `packages/project-config/src/__tests__/config.test.ts`

Add a test that the default `dbModule` is `'src/lib/db'`:

```ts
it('defaults dbModule to src/lib/db', () => {
  const config = getConfig()
  expect(config.api.dbModule).toBe('src/lib/db')
})
```

### `packages/babel-config/src/__tests__/...` (or create new test)

Add a test for the gqlorm Babel plugin that verifies:

- With default options, it injects `from 'src/lib/db'`
- With `dbModule: '@myorg/db'` passed in state.opts, it injects `from '@myorg/db'`

---

## Future Considerations

1. **Multi-database support** — if Cedar ever supports multiple databases
   (e.g., one for auth, one for app data), this config key could become a map:

   ```toml
   [api.prismaClients]
     default = "@scope/db"
     auth = "@scope/auth-db"
   ```

2. **Prisma config path extraction** — if a user also wants to move
   `prisma.config.cjs` and `schema.prisma` into the shared package,
   `[api].prismaConfig` in `cedar.toml` already supports this. The two config
   keys work independently.

3. **Vite caching** — changing `dbModule` changes import sources
   across many files. A `yarn cedar dev` restart or Vite cache clear may be
   needed after the change (this is already the case for other config changes).

4. **Build-time config availability** — the Babel plugin and codegen tools all
   run at build/dev time with access to the full Cedar project config. No
   runtime config resolution is needed.
