# Prisma v6 Configuration Migration

**Date:** 2025-11-20

## Overview

Cedar now supports Prisma v6's `prisma.config.{ts,js,cjs}` configuration file.
This migration moves from the legacy `schema.prisma` path configuration to a
dedicated config file that defines schema location, migrations path, and other
Prisma settings.

## What Changed

### Core Implementation

**New Module:** `packages/project-config/src/prisma.ts`

- `loadPrismaConfig()` - Loads and caches Prisma config files
- `getSchemaPath()` - Returns schema path from config (defaults to
  `schema.prisma`)
- `getMigrationsPath()` - Returns migrations path (defaults to `db/migrations`)
- `getDbDir()` - Returns directory containing the schema
- `getDataMigrationsPath()` - Returns Cedar data migrations path

**Configuration Updates:**

- Default config path: `./api/prisma.config.cjs`
- Config path stored in `cedar.config.js` under `api.prismaConfig`
- Path resolution supports `.ts`, `.js`, `.cjs` extensions

**CLI Changes:**

- All Prisma CLI commands now use `--config` instead of `--schema`
- `cedar prisma` automatically passes config file path
- Removed schema existence checks (Prisma is a hard requirement)

### Path Structure

**Before (Prisma v5):**

```
api/
  db/
    schema.prisma
    migrations/
```

**After (Prisma v6):**

```
api/
  prisma.config.ts
  db/
    schema.prisma
    migrations/
```

### Example Config File

```typescript
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Migration Guide for Users

### Existing Projects

1. Create `api/prisma.config.cjs` (or `.ts`/`.js`):

```javascript
const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

2. Update `cedar.config.js` (optional - uses default if omitted):

```javascript
api: {
  prismaConfig: './api/prisma.config.cjs',
}
```

3. Continue using `cedar prisma` commands as before - they now automatically use
   the config file.

### New Projects

New Cedar projects include `prisma.config.cjs` by default.

## Implementation Notes

- Config files are cached to avoid repeated file system operations
- Data migrations path defaults to `db/dataMigrations` (Cedar feature)
- **CommonJS Build**: The CJS build converts `await import()` to `require()` for
  Jest compatibility
  - Supports both ESM default exports (`module.default`) and CommonJS exports
    (direct `module` object)
  - Uses `module.default || module` fallback to handle both export styles

## Benefits

1. **Prisma v6 compatibility** - Aligns with Prisma's recommended configuration
   approach
2. **Flexibility** - Easier to customize schema location and migrations path
3. **Type safety** - Config files can use TypeScript with full type checking
4. **Future-proof** - Ready for Prisma's evolving configuration options

Notes added by Tobbe

2025-11-24

I've decided to remove some of the support Cedar had for not using Prisma. It wasn't really supported everywhere anymore anyway. Prisma is just too ingrained in the framework by now users can't really opt out. So no need to keep the half-working support for it around anymore. For now this relates to some cli commands, but I might continue removing such code when I bump into it in the future.

2025-11-24

I was struggling with this error message from Prisma that I saw in CI when I tried to merge this PR

```
Running Prisma CLI...
$ yarn prisma db push --force-reset --accept-data-loss --config /home/runner/work/cedar/test-project/api/prisma.config.cjs

Loaded Prisma config from api/prisma.config.cjs.

Prisma config detected, skipping environment variable loading.
Prisma schema loaded from api/db/schema.prisma
Datasource "db": SQLite database "test.db" at "file:/home/runner/work/cedar/test-project/.redwood/test.db"

SQLite database test.db created at file:/home/runner/work/cedar/test-project/.redwood/test.db

The SQLite database "test.db" at "file:/home/runner/work/cedar/test-project/.redwood/test.db" was successfully reset.

🚀  Your database is now in sync with your Prisma schema. Done in 18ms

Running generate... (Use --skip-generate to skip the generators)
Running generate... - Prisma Client
✔ Generated Prisma Client (v6.19.0) to ./node_modules/@prisma/client in 58ms

FAIL api api/src/services/contacts/contacts.test.ts
  ● contacts › returns all contacts

    Failed to load Prisma config from /home/runner/work/cedar/test-project/api/prisma.config.cjs: TypeError [ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG]: A dynamic import callback was invoked without --experimental-vm-modules

      at loadPrismaConfig (node_modules/@cedarjs/project-config/dist/cjs/index.js:503:11)
      at getSchemaPath (node_modules/@cedarjs/project-config/dist/cjs/index.js:510:18)
      at configureTeardown (node_modules/@cedarjs/testing/config/jest/api/jest.setup.js:63:22)
      at Object.<anonymous> (node_modules/@cedarjs/testing/config/jest/api/jest.setup.js:233:5)
```

I couldn't reproduce it locally with a default `yarn create cedar-app` project, but when I tried with a project generated by `yarn build:test-project`, it reproduced after doing a tarsync.

Diving into the built cjs code for `@cedarjs/project-config` I noticed an `await import` statement, and that made me remember a previous, similar issue, I had with Jest. After a quick search, I found a comment I left in the source for this in `packages/testing/build.mts`:

```ts
// ./src/web/mockRequests.js contains `... = await import('msw/node'`. When
// building for CJS esbuild correctly preserves the `await import` statement
// because it's valid in both CJS and ESM (whereas regular imports are only
// valid in ESM).
// The problem is that this file will be consumed by Jest, and jest doesn't
// support that syntax. They only support `require()`.
```

So I'll have to do something similar for this instance of `await import()` in
`packages/project-config/build.ts`.

---

## Bug Fix: CommonJS Config Loading (2025-11-25)

**Issue:** The CJS build had a bug where CommonJS config files (`module.exports`) would fail to load.

**Root Cause:** The build script's post-processing converted `await import()` to `require()`, but expected ESM-style default exports (`module.default`). CommonJS files export directly on the module object.

**Solution:** Updated build script to support both export styles: `module.default || module`

**Changes:**

- `packages/project-config/src/prisma.ts` - Removed `pathToFileURL` import, use file path directly, and do `mod.default || mod` to support both ESM and CJS exports.
