# Configurable Prisma Client Module Path

## Table of Contents

- [Overview](#overview)
- [Motivation](#motivation)
- [Architecture Decisions](#architecture-decisions)
- [Config Change](#config-change)
- [Runtime Infrastructure Changes](#runtime-infrastructure-changes)
- [Code Generator Changes](#code-generator-changes)
- [Template Changes](#template-changes)
- [Setup Command Changes](#setup-command-changes)
- [Codemod Changes](#codemod-changes)
- [Complete File Change Summary](#complete-file-change-summary)
- [How It Works at Runtime](#how-it-works-at-runtime)
- [User-Facing Usage](#user-facing-usage)
- [Future Considerations](#future-considerations)

---

## Overview

Allow Cedar users to configure the module path from which the framework imports
the Prisma client singleton (`db`). Today this path is hardcoded as
`src/lib/db` in ~20 files across generators, Babel plugins, testing
infrastructure, and templates. This change makes it configurable via
`cedar.toml`, enabling users to extract their Prisma schema, migrations, and
client into a shared monorepo package (e.g. `packages/db/`) that multiple
workspaces can depend on — including non-Cedar apps.

---

## Motivation

A Cedar user wants to:

1. Extract Prisma schema + migrations + generated client into a shared workspace
   package (e.g. `packages/db/` or `@scope/db`).
2. Have the Cedar `api` workspace import `db` from that shared package instead
   of from `api/src/lib/db.ts`.
3. Build a new non-Cedar app in the same monorepo that also uses this shared
   database package, without duplicating the Prisma setup.

Currently this is possible but fragile — it requires keeping
`api/src/lib/db.ts` as a thin re-export proxy because the framework has no
configurable way to change where it expects the `db` singleton to live.

This plan makes the `db` module path a first-class configuration option.

---

## Architecture Decisions

**Decision 1: Single config key in `cedar.toml` (`[api].dbModule`)**

A single key controls the import source for the Prisma client singleton.
Default: `"src/lib/db"`. Users set it to a bare package specifier like
`"@scope/db"` to point at a shared workspace package. All generators, Babel
plugins, testing infrastructure, and templates read from this one value.

**Decision 2: Support both bare specifiers and path-based imports**

When the value starts with `@` or is a package name (no leading `.` or `/`),
treat it as a bare specifier — pass it directly into `import` statements.
When the value looks like a relative path (e.g. `src/lib/db`), resolve it via
the existing `src/` alias machinery. This preserves backward compatibility.

**Decision 3: `$api` alias in web-side types gets special handling**

The web-side type generation in `graphqlCodeGen.ts` currently generates
`import { Prisma } from "$api/src/lib/db"`. The `$api` prefix is a web-side Vite
alias that resolves to the api workspace. When `dbModule` is set to a bare
package specifier (e.g. `@scope/db`), the `$api` wrapper is unnecessary — the
web workspace can import directly from the shared package. The codegen must
detect this case and omit the `$api` prefix.

**Decision 4: Codemods stay pinned to the default convention (de-scoped)**

The `v2.7.x` and `v3.x` Prisma codemods that rewrite imports through
`src/lib/db` are migration tools for existing projects. Users who change
`dbModule` are self-selecting for a non-default setup and are responsible for
their own import paths. Updating codemods for this edge case adds complexity
without meaningful value.

---

## Config Change

### `packages/project-config/src/config.ts`

Add a new key to the `api` config section:

```typescript
api: {
  // ... existing keys
  dbModule: string // default: "src/lib/db"
}
```

Default value: `"src/lib/db"` (backward compatible).

### `packages/project-config/src/paths.ts`

Add a helper to resolve the module identifier:

```typescript
// Returns the configured import source for the Prisma client singleton.
// For bare specifiers (e.g. "@scope/db"), returns the specifier as-is.
// For relative paths (e.g. "src/lib/db"), returns the path relative to
// the api src directory (so the existing "src/" Vite/Babel alias works).
getPrismaClientModule(): string {
  const module = getConfig(getConfigPath(BASE_DIR)).api.dbModule
  return module
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

**Change:** Read `dbModule` from `@cedarjs/project-config` and use
that value instead:

```js
const { getPrismaClientModule } = require('@cedarjs/project-config')
// ...
t.stringLiteral(getPrismaClientModule())
```

This is the most architecturally significant change. The Babel plugin injects
`import { db as __gqlorm_db__ } from '<module>'` into the compiled
`api/src/functions/graphql.ts` at build time. If the module path is wrong,
gqlorm live queries will break.

**Note:** The Babel plugin runs at build time (Vite SSR build for the API
side), so it has access to the full Cedar project config at that point.

### 2. `packages/testing/src/api/vitest/vite-plugin-track-db-imports.ts`

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

### 3. `packages/testing/src/api/vitest/vitest-api.setup.ts`

**Line 357:**

```js
const libDb = await import(`${cedarPaths.api.lib}/db`)
```

**Change:** Use the configured module path:

```js
const prismaModule = getPrismaClientModule()
const libDb = await import(
  prismaModule.startsWith('src/')
    ? `${cedarPaths.api.src}/${prismaModule.replace('src/', '')}`
    : prismaModule
)
```

### 4. `packages/testing/src/config/jest/api/jest.setup.ts`

**Line 134:**

```js
const { db } = await import(`${apiSrcPath}/lib/db`)
```

**Line 306:**

```js
const libDbPath = require.resolve(`${apiSrcPath}/lib/db`)
```

**Change:** Same pattern — resolve the module path from config.

### 5. `packages/testing/src/config/jest/api/jest-preset.ts`

**Line 49** — Jest `moduleNameMapper`:

```js
'^src/(.*)$': path.join(rwjsPaths.api.src, '$1')
```

**Change:** If `dbModule` is a bare specifier, the Jest config needs
a module mapper entry for that package to resolve it correctly (e.g., map
`@scope/db` to the workspace package's source). If it's still a `src/` path,
the existing mapper handles it.

### 6. `packages/testing/src/api/vitest/vite-plugin-cedar-vitest-api-config.ts`

**Line 18:**

```js
src: getPaths().api.src
```

**Change:** If `dbModule` is a bare specifier, add an additional
Vite resolve alias mapping the package name to its source directory.

---

## Code Generator Changes

These generate user-facing code with wrong import paths when
`dbModule` is changed.

### 7. `packages/cli/src/commands/generate/service/serviceHandler.js`

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

### 8. `packages/cli/src/commands/generate/service/templates/service.ts.template`

**Line 3** — Hardcoded (not using the template variable):

```
import { db } from 'src/lib/db'
```

**Change:** Use the template variable `${prismaImportSource}` consistently:

```
import { db } from '${prismaImportSource}'
```

### 9. `packages/cli/src/commands/generate/service/templates/test.ts.template`

**Line 34:**

```
import { Prisma, Model } from '${prismaImportSource}'
```

**Change:** No template change needed — already uses `${prismaImportSource}`.
The fix in `serviceHandler.js` (item 7) flows through.

### 10. `packages/cli/src/commands/generate/service/templates/scenarios.ts.template`

**Lines 1-3:**

```
import type { Prisma, ${prismaModel} } from '${prismaImportSource}'
```

**Change:** No template change needed — already uses `${prismaImportSource}`.

### 11. `packages/cli/src/commands/generate/dataMigration/dataMigration.js`

**Line 50:**

```js
const prismaImportSource = 'src/lib/db'
```

**Change:** Read from project config (same pattern as item 7).

### 12. `packages/cli/src/commands/generate/dataMigration/templates/dataMigration.ts.template`

**Line 1:**

```
import type { PrismaClient } from '${prismaImportSource}'
```

**Change:** No template change needed.

### 13. `packages/cli/src/commands/generate/dataMigration/templates/dataMigration.js.template`

**Line 2:**

```
@param {{db: PrismaClient}} db
```

**Change:** No template change needed (JSDoc type comes from the template
variable indirectly).

### 14. `packages/internal/src/generate/graphqlCodeGen.ts`

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
// If bare specifier, use directly. If src/ path, use as-is (Vite resolves).
`import { Prisma } from "${prismaImportSource}"`

// web/types/graphql.d.ts
// If bare specifier (e.g. "@scope/db"), use directly — no $api prefix needed.
// If src/ path, wrap with $api/ (existing behavior).
const webImportSource = prismaImportSource.startsWith('src/')
  ? `$api/${prismaImportSource}`
  : prismaImportSource`import { Prisma } from "${webImportSource}"`
```

### 15. `packages/record/src/tasks/parse.js`

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

### 16-19. `packages/create-cedar-app/templates/*/scripts/seed.{ts,js}` (4 files)

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

### 20-25. `packages/create-cedar-app/templates/*/api/src/lib/db.{ts,js}` (4 files + 2 database overlays)

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

### 26. `packages/cli/src/commands/setup/uploads/uploadsHandler.js`

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

### 27. `packages/cli/src/lib/exec.js`

**Line 142:**

```js
path.join(getPaths().api.lib, 'db')
```

**Change:** Resolve from config. The exec runner disconnects the Prisma client
after script execution. It needs to `import()` the module from the configured
path (or `require.resolve` it) rather than assuming `api/src/lib/db`.

---

## Codemod Changes

### 28-34. `packages/codemods/src/codemods/v3.x/prismaV7/` and `v2.7.x/prismaV7Prep/` (~7 files)

**Decision:** De-scoped. These Prisma migration codemods assume the default
convention (`src/lib/db` / `api/src/lib/db`). Users who customize
`dbModule` are responsible for their own import paths. No changes
needed.

---

## Complete File Change Summary

### Additions (1 file)

- New config key documentation / defaults in `project-config/src/config.ts`

### Modifications (13 files)

| #   | File                                                                       | Effort | Notes                                    |
| --- | -------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| 1   | `packages/project-config/src/paths.ts`                                     | Small  | Add `getPrismaClientModule()`            |
| 2   | `packages/babel-config/src/plugins/babel-plugin-cedar-gqlorm-inject.ts`    | Medium | Read config, use dynamic import source   |
| 3   | `packages/testing/src/api/vitest/vite-plugin-track-db-imports.ts`          | Medium | Make regex/module detection config-aware |
| 4   | `packages/testing/src/api/vitest/vitest-api.setup.ts`                      | Small  | Dynamic import from configured module    |
| 5   | `packages/testing/src/config/jest/api/jest.setup.ts`                       | Small  | Two dynamic import sites                 |
| 6   | `packages/testing/src/config/jest/api/jest-preset.ts`                      | Small  | Module mapper for custom paths           |
| 7   | `packages/testing/src/api/vitest/vite-plugin-cedar-vitest-api-config.ts`   | Small  | Alias for bare specifiers                |
| 8   | `packages/cli/src/commands/generate/service/serviceHandler.js`             | Small  | `prismaImportSource` from config         |
| 9   | `packages/cli/src/commands/generate/service/templates/service.ts.template` | Small  | Use `${prismaImportSource}`              |
| 10  | `packages/cli/src/commands/generate/dataMigration/dataMigration.js`        | Small  | `prismaImportSource` from config         |
| 11  | `packages/internal/src/generate/graphqlCodeGen.ts`                         | Medium | API + web type gen, `$api` handling      |
| 12  | `packages/record/src/tasks/parse.js`                                       | Small  | `dbModule` from config                   |
| 13  | `packages/cli/src/commands/setup/uploads/uploadsHandler.js`                | Medium | Resolve db file path from module         |
| 14  | `packages/cli/src/lib/exec.js`                                             | Small  | Resolve from config                      |

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
5. **Non-Cedar app** — `import { db } from '@my-scope/db'` works directly

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
#     prismaConfig = "./api/prisma.config.cjs"  # or point into packages/db/

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
