# Prisma v7

Cedar now ships with Prisma v7. This is a breaking change that affects how the
Prisma client is generated, where your database URL is configured, and how
`db.ts` is structured. Most of these changes can be applied automatically with
the provided codemod.

## Automatic migration (recommended)

Run the following codemod to upgrade your project automatically:

```bash
yarn dlx @cedarjs/codemods prisma-v7
```

This will:

1. Rewrite the `generator client` block in `api/db/schema.prisma` to the new
   Prisma v7 format and remove the `url` line from `datasource db`
2. Update `api/prisma.config.cjs` to add `datasource: { url: env('DATABASE_URL') }`.
   This is the database url used by the prisma CLI.
3. Update `api/src/lib/db.ts`: Rewrites imports to the new generated client path
   and adds the `PrismaBetterSqlite3` driver adapter (SQLite projects only)
4. Rewrite any remaining `@prisma/client` imports across your project to go
   through `src/lib/db` instead
5. Add `@prisma/adapter-better-sqlite3` and `better-sqlite3` to `api/package.json`
   (SQLite projects only)
6. Add `"allowImportingTsExtensions": true` to `api/tsconfig.json`,
   `scripts/tsconfig.json`, and `web/tsconfig.json`
7. Add `api/db/generated/prisma` to `.gitignore`
8. Update `DATABASE_URL` in `.env.defaults` from `file:./dev.db` to
   `file:./db/dev.db`

After running the codemod:

```bash
yarn install
yarn cedar prisma generate
yarn cedar prisma migrate dev
yarn cedar lint --fix   # fixes any import ordering changes
```

If you use a non-SQLite database (PostgreSQL, MySQL, etc.), the codemod will
only rewrite import paths. You will need to add an appropriate Prisma driver
adapter to `api/src/lib/db.ts` yourself. See the
[Prisma driver adapter docs](https://www.prisma.io/docs/orm/overview/databases/database-drivers)
for details.

---

## What changed and why

### Database URL is no longer configured in `schema.prisma`

Previously, the database URL lived in `schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

The datasource db url was used both for the Prisma CLI and the Prisma Client. In
Prisma v7, the URL that is used by the Prisma CLI is configured in
`api/prisma.config.cjs`, and the url used by the client is configured in code
when you set up the client adapter (done in `api/src/lib/db.ts` for Cedar apps)

```js
const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

And `schema.prisma` now just has:

```prisma
datasource db {
  provider = "sqlite"
}
```

See further down in the release notes for details on `db.ts`.

### New `generator client` block format

The old format:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = "native"
}
```

The new Prisma v7 format:

```prisma
generator client {
  provider               = "prisma-client"
  output                 = "./generated/prisma"
  moduleFormat           = "cjs"
  generatedFileExtension = "mts"
  importFileExtension    = "mts"
}
```

The generated client now lives at `api/db/generated/prisma/` instead of
`node_modules/.prisma/client/`. This new directory is gitignored and regenerated
on demand. `binaryTargets` is no longer applicable as the new driver is written
in TypeScript and works on all targets.

### `db.ts` now uses a driver adapter

For SQLite projects, `api/src/lib/db.ts` now uses the `PrismaBetterSqlite3`
driver adapter and imports `PrismaClient` from the generated client path:

```ts
import path from 'node:path'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from 'api/db/generated/prisma/client.mts'

import { emitLogLevels, handlePrismaLogging } from '@cedarjs/api/logger'
import { getPaths } from '@cedarjs/project-config'

import { logger } from './logger.js'

export * from 'api/db/generated/prisma/client.mts'

const resolveSqliteUrl = (url = 'file:./db/dev.db') => {
  if (!url.startsWith('file:.')) {
    return url
  }

  return `file:${path.resolve(getPaths().api.base, url.slice('file:'.length))}`
}

const adapter = new PrismaBetterSqlite3({
  url: resolveSqliteUrl(process.env.DATABASE_URL),
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

export const db = prismaClient
```

The `resolveSqliteUrl` helper resolves relative `file:./...` paths against the
`api/` directory. This ensures that Prisma CLI commands (which always resolves
paths relative to the `prisma.config.cjs` file, which for Cedar apps lives in
`api/` by default) and the sqlite adapter both find the same SQLite file.

Any code that previously imported types directly from `@prisma/client` (such as
`import type { Prisma } from '@prisma/client'`) should now import from
`src/lib/db` instead. The codemod handles this automatically.

---

## SQLite `DATABASE_URL` path change

If your project uses SQLite, update your `DATABASE_URL` from:

- `file:./dev.db`

to:

- `file:./db/dev.db`

This keeps the SQLite database file in `api/db/dev.db`, which is where Cedar's
Prisma v7 setup expects it to live.

In practice, this means updating the value in the env file your project uses:

```
DATABASE_URL=file:./db/dev.db
```

The codemod updates `.env.defaults` for you automatically, but if you have the
old value set in your `.env` file you will need to update it manually (`.env` is
gitignored and is not modified automatically for safety reasons).

If you leave the old value in place, Prisma CLI commands and runtime database
access can end up pointing at different files, which may show up as errors like
"table does not exist" even though the expected tables exist in another SQLite
file.

---

## Testing

For most projects, testing works the same as before. If you have
`DATABASE_URL` in your `prisma.config.cjs`, Cedar will substitute it with
`TEST_DATABASE_URL` during tests, exactly as before.

However, if you previously used `directUrl` in `schema.prisma` to configure a
direct connection URL for testing (common with connection pooling providers like
Supabase or PlanetScale), you now need to configure this in `prisma.config.cjs`
instead. Cedar no longer parses `schema.prisma` to find the what was previously
the "directUrl". Instead, you configure the URL explicitly in the config file.

If your project needs a separate URL, that is _not_ the `TEST_DATABASE_URL` for
CLI commands like `prisma migrate` and `prisma reset` during tests, the
recommended approach is:

```js
// prisma.config.cjs
module.exports = {
  // ...
  datasource: {
    url: env('NODE_ENV') === 'test'
      ? env('TEST_DIRECT_DATABASE_URL')
      : env('DIRECT_DATABASE_URL'),
```

Most projects that use the default `url: env('DATABASE_URL')` are unaffected.
Cedar will continue to swap in `TEST_DATABASE_URL` automatically during tests.

If your schema previously had a `directUrl` line, the codemod will remove it
from `schema.prisma` and print a warning reminding you to update
`prisma.config.cjs` manually.

- [ ] Write upgrade script that warns about `directUrl`
- [ ] Warn about custom `prisma.config.cjs` path (from cedar.toml) for sqlite
      apps

# Breaking Changes

## Babel Target Updated: Node.js 20.10 → 24

Cedar now targets **Node.js 24** as the minimum version for the API side for the
babel config. This allows us to remove several Babel plugins for class fields,
private methods, and nullish coalescing. All those are natively supported in
Node 24.

**Note** that Cedar already officially moved to Node 24 with the release of
Cedar v2.0.0. So unless you're running on an unsupported version of Node, this
change should not affect you at all.

## Removed: core-js Polyfills

`core-js` and `@babel/runtime-corejs3` have been completely removed from Cedar.
The framework was only polyfilling stage 1–3 TC39 proposals, which are not
recommended for production use and are not used anywhere in Cedar itself.

If you need polyfills for any feature it's now up to you to configure it
yourself in your app.
