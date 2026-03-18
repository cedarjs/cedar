# Prisma v7 Prep

Prepares your project for Prisma v7 by funneling all Prisma imports through
`src/lib/db` instead of directly from `@prisma/client`. This makes the future
v7 migration a one-line change.

This codemod:

- Adds `export * from '@prisma/client'` to `api/src/lib/db.ts` (or `.js`) if not
  already present.
- Updates all imports from `@prisma/client` under `api/src/`,
  `api/db/dataMigrations/`, and `scripts/` to import from `src/lib/db` instead.

Run this codemod while your project is still on Prisma v6.
