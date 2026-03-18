# Prisma v7

Upgrades your Cedar app to use Prisma v7 by transforming all project files that
changed as part of the Prisma v7 migration.

## Usage

```bash
npx @cedarjs/codemods prisma-v7
```

## What it does

This codemod runs the following transformations in order:

### 1. Update `api/db/schema.prisma`

- Removes `url = env("DATABASE_URL")` from the `datasource db` block — the URL
  is now configured in `prisma.config.cjs` instead.
- Replaces the old Prisma v6 generator block:

  ```prisma
  generator client {
    provider      = "prisma-client-js"
    binaryTargets = "native"
  }
  ```

  with the new Prisma v7 format:

  ```prisma
  generator client {
    provider               = "prisma-client"
    output                 = "./generated/prisma"
    moduleFormat           = "cjs"
    generatedFileExtension = "mts"
    importFileExtension    = "mts"
  }
  ```

- Warns if a `directUrl` was found in the schema (you'll need to move it to
  `prisma.config.cjs` manually).
- Warns if custom `binaryTargets` were found and removed.

### 2. Update `api/prisma.config.cjs`

Adds `env` to the `require('prisma/config')` destructure and inserts a
`datasource` block so the database URL is configured in one place:

```js
const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  // ...existing config...
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

### 3. Update `api/src/lib/db.{ts,js}`

Rewrites the Prisma client file to:

- Import `PrismaClient` from the new generated path
  (`api/db/generated/prisma/client.mts`) instead of `@prisma/client`
- Re-export everything from the new generated path
- Add the `PrismaBetterSqlite3` driver adapter and a `resolveSqliteUrl` helper
  (SQLite projects only)
- Pass the `adapter` to `new PrismaClient()`

For non-SQLite projects only the import paths are rewritten. A note is printed
pointing to the Prisma docs for adding a driver adapter manually.

### 4. Rewrite remaining `@prisma/client` imports

Scans `api/src/`, `api/db/dataMigrations/`, and `scripts/` for any remaining
direct `@prisma/client` imports and rewrites them to go through
`src/lib/db` (for `api/src/`) or `api/src/lib/db` (for `scripts/`). This is a
safety net for files added after the `prisma-v7-prep` codemod ran, or for
projects that never ran `prisma-v7-prep`.

### 5. Update `api/package.json` _(SQLite projects only)_

Adds the SQLite driver adapter dependencies:

- `@prisma/adapter-better-sqlite3`
- `better-sqlite3`

For non-SQLite projects a note is printed reminding you to add the appropriate
adapter package yourself.

### 6. Update `tsconfig.json` files

Adds `"allowImportingTsExtensions": true` to `compilerOptions` in:

- `api/tsconfig.json`
- `scripts/tsconfig.json`
- `web/tsconfig.json`

This is needed because `db.ts` now imports from a path with a `.mts` extension.

### 7. Update `.gitignore`

Adds `api/db/generated/prisma` to `.gitignore` so the generated Prisma client
files are not committed to version control.

### 8. Update `.env.defaults`

Updates the default SQLite `DATABASE_URL` from `file:./dev.db` to
`file:./db/dev.db` to match the new generated client output location.

If your `.env` file still contains the old path, a warning is printed — you
should update it manually since `.env` may contain secrets and is not modified
automatically.

## After running this codemod

```bash
# Install the new adapter dependencies
yarn install

# Generate the new Prisma client
yarn cedar prisma generate

# Verify your migrations still work
yarn cedar prisma migrate dev

# Fix any import ordering issues
yarn cedar lint --fix
```

## Notes

- **Idempotent:** Safe to run multiple times. Already-migrated files are left
  unchanged.
- **SQLite vs PostgreSQL:** The `PrismaBetterSqlite3` adapter is only added for
  SQLite projects. For PostgreSQL and other databases, you will need to add an
  appropriate adapter yourself. See the
  [Prisma driver adapter docs](https://www.prisma.io/docs/orm/overview/databases/database-drivers).
- **`directUrl`:** If you previously used `directUrl` in your `schema.prisma`
  (common with connection pooling providers like Supabase or PlanetScale), you
  must add it to your `prisma.config.cjs` manually:

  ```js
  datasource: {
    url: env('DIRECT_DATABASE_URL'),
  },
  ```

## Related

- [`prisma-v7-prep`](../../v2.7.x/prismaV7Prep/README.md); Run this first if
  you are upgrading from Cedar v2.7.x or v2.8.x and haven't already run the
  prep codemod.
