# Prisma v7 Migration Plan — Phase 1 (v6-compatible prep work)

## Goal

Decouple the most disruptive user-facing change — the `@prisma/client` import
path — from the actual Prisma v7 upgrade. By funneling all Prisma imports
through `src/lib/db` while still on v6, the eventual v7 switch becomes a
one-line change in `db.ts` rather than a project-wide import rewrite.

## Background

Cedar uses **v6 patterns**:

- `provider = "prisma-client-js"` in all `schema.prisma` files
- No `output` field (client generated into `node_modules/.prisma/client`)
- All user code imports directly from `@prisma/client`
- No driver adapters
- Framework codegen hardcodes `import { Prisma } from "@prisma/client"` in
  generated type files

Prisma v7's new `prisma-client` generator outputs to a **local project path**
(e.g. `api/db/generated/prisma/`), making the `@prisma/client` import path
obsolete. This change touches every service, scenario, and test file in every
Cedar app. Doing it on v6 — where `@prisma/client` still works — lets us
validate the migration safely.

### Why `src/lib/db` and not a TSConfig path alias or direct relative imports?

- **Direct relative imports** (`../../../db/generated/prisma/client.js`) are
  ugly and fragile in Cedar's nested directory structure.
- **TSConfig path aliases** (`@db/client`) only work at the TypeScript level —
  Node.js ignores them at runtime, requiring a second resolution mechanism
  (Vite config, test runner config, etc.) to stay in sync. They also diverge
  from Prisma's docs, meaning community answers and examples won't apply.
- **Re-exporting from `db.ts`** uses Cedar's existing `src/*` path alias, works
  at both type-check and runtime, requires no new configuration, and matches
  how services already import `db`.

### Generated client location (for the future v7 PR)

We have decided to place the Prisma generated client at `api/db/generated/`.
This keeps it next to the schema file (`api/db/schema.prisma`), which is the
Prisma convention. This decision does not affect the current PR — it only
matters when we later add `output = "./generated/prisma"` to the schema.

### ESM compatibility

Cedar requires Node 24, which supports `require(esm)`. This means CJS Cedar
apps (without `"type": "module"`) can consume Prisma v7's ESM-only packages
without any changes. The `prisma.config.cjs` files continue to work. Full ESM
migration is **not** a prerequisite for Prisma v7.

---

## Changes

### 1. Add `export * from '@prisma/client'` to `db.ts` templates

This is the core change. It makes `src/lib/db` a superset of `@prisma/client`,
so all downstream code can import Prisma types from there instead.

**Files to update (4 templates):**

- `packages/create-cedar-app/templates/ts/api/src/lib/db.ts`
- `packages/create-cedar-app/templates/js/api/src/lib/db.js`
- `packages/create-cedar-app/templates/esm-ts/api/src/lib/db.ts`
- `packages/create-cedar-app/templates/esm-js/api/src/lib/db.js`

**Change:**

Add one line after the existing `@prisma/client` import:

```ts
export * from '@prisma/client'
```

When we later switch to Prisma v7's generated client, this becomes:

```ts
export * from '../db/generated/prisma/client.js'
```

And nothing else in the project needs to change.

**Note:** There is no naming collision — `@prisma/client` exports `PrismaClient`,
`Prisma`, and model types. The existing `export const db = prismaClient` in
`db.ts` does not conflict with any of these.

### 2. Update generator templates to import from `src/lib/db`

Four generator templates currently import from `@prisma/client`:

#### a. Service scenario template

`packages/cli/src/commands/generate/service/templates/scenarios.ts.template`

```
// Before
import type { Prisma, ${prismaModel} } from '@prisma/client'

// After
import type { Prisma, ${prismaModel} } from 'src/lib/db'
```

#### b. Service test template

`packages/cli/src/commands/generate/service/templates/test.ts.template`

```
// Before (type-only)
import type { ${prismaModel} } from '@prisma/client'
// Before (value import, for Prisma.Decimal etc.)
import { Prisma, ${prismaModel} } from '@prisma/client'

// After (type-only)
import type { ${prismaModel} } from 'src/lib/db'
// After (value import)
import { Prisma, ${prismaModel} } from 'src/lib/db'
```

#### c. Data migration template (TypeScript)

`packages/cli/src/commands/generate/dataMigration/templates/dataMigration.ts.template`

```
// Before
import type { PrismaClient } from '@prisma/client'

// After
import type { PrismaClient } from 'src/lib/db'
```

#### d. Data migration template (JavaScript)

`packages/cli/src/commands/generate/dataMigration/templates/dataMigration.js.template`

```
// Before
@typedef { import("@prisma/client").PrismaClient } PrismaClient

// After
@typedef { import("src/lib/db").PrismaClient } PrismaClient
```

### 3. Update GraphQL codegen to emit imports from `src/lib/db`

`packages/internal/src/generate/graphqlCodeGen.ts`

#### API side (lines ~73-77)

```ts
// Before
content: [
  'import { Prisma } from "@prisma/client"',
  "import { MergePrismaWithSdlTypes, MakeRelationsOptional } from '@cedarjs/api'",
  `import { ${prismaImports.join(', ')} } from '@prisma/client'`,
],

// After
content: [
  'import { Prisma } from "src/lib/db"',
  "import { MergePrismaWithSdlTypes, MakeRelationsOptional } from '@cedarjs/api'",
  `import { ${prismaImports.join(', ')} } from 'src/lib/db'`,
],
```

#### Web side (lines ~137-140)

```ts
// Before
content: 'import { Prisma } from "@prisma/client"',

// After
content: 'import { Prisma } from "$api/src/lib/db"',
```

**Note:** The web side `graphql.d.ts` uses `Prisma.JsonValue` and
`Prisma.JsonObject` for scalar type mappings. We use the `$api/src/lib/db`
alias here to ensure it resolves to the API side's `db.ts` and avoids any
potential conflicts if a user happens to have a `src/lib/db.ts` file on the
web side.

### 4. Update all fixture projects

Every `__fixtures__/` project and `test-project/` needs the same two changes:
add the re-export to `db.ts`, and update service/scenario/test imports.

**Fixture `db.ts` files to update:**

- `__fixtures__/empty-project/api/src/lib/db.ts`
- `__fixtures__/esm-test-project/api/src/lib/db.ts`
- `__fixtures__/rsc-caching/api/src/lib/db.ts`
- `__fixtures__/test-project/api/src/lib/db.ts`
- `__fixtures__/test-project-live/api/src/lib/db.ts`
- `__fixtures__/test-project-rsa/api/src/lib/db.ts`
- `__fixtures__/test-project-rsc-kitchen-sink/api/src/lib/db.ts`
- `test-project/api/src/lib/db.ts`

**Fixture service/scenario/test files with `@prisma/client` imports:**

These are spread across all fixture projects under `api/src/services/`.
Every `*.scenarios.ts` and `*.test.ts` file that imports from `@prisma/client`
needs to be updated to import from `src/lib/db`. A quick way to find them all:

```
rg "from '@prisma/client'" __fixtures__/ test-project/ --files-with-matches
```

Fixture `scripts/seed.ts` files already import from `api/src/lib/db` — no
changes needed there.

### 5. Update upload setup test fixtures

`packages/cli/src/commands/setup/uploads/__testfixtures__/` contains `db.ts`
snapshots used for testing the uploads setup command. These need the re-export
added:

- `__testfixtures__/defaultDb.input.ts`
- `__testfixtures__/defaultDb.output.ts`
- `__testfixtures__/oldFormat.input.ts`

### 6. Update generator test snapshots

The service generator tests have snapshots that assert the generated output.
These will need to be updated to reflect the new import paths:

- `packages/cli/src/commands/generate/service/__tests__/__snapshots__/service.test.js.snap`

All occurrences of `from '@prisma/client'` in the snapshot should become
`from 'src/lib/db'`.

The simplest way to update these is to run the tests and let them update
automatically:

```
yarn test packages/cli/src/commands/generate/service --update
```

### 7. Write a codemod for user projects

Add one or more codemods (in `packages/codemods/src/codemods/v2.7.x/) that
existing Cedar app users can run to migrate their projects. The codemod(s)
should:

1. Add `export * from '@prisma/client'` to `api/src/lib/db.ts` (or `.js`)
   — if the line is not already present.
2. Rewrite all `from '@prisma/client'` imports under `api/src/` to
   `from 'src/lib/db'` (preserving `type` vs value import distinction).
3. Rewrite `from '@prisma/client'` imports under `api/db/dataMigrations/` if
   present.

The codemods do **not** need to touch:

- `schema.prisma` (no changes on v6)
- `prisma.config.cjs` / `prisma.config.ts` (already correct)
- `package.json` (no new dependencies on v6)

---

## Out of Scope (deferred to the v7 PR)

These changes require Prisma v7's new generator and cannot be done on v6:

| Change                                                   | Why it requires v7                                            |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `provider = "prisma-client"` + `output` in schema        | New generator, v7 only                                        |
| Removing `binaryTargets`                                 | Rust engine still used on v6                                  |
| Driver adapters (`@prisma/adapter-better-sqlite3`, etc.) | Different API on v6                                           |
| Updating `db.ts` re-export to point at generated path    | Needs the generated output to exist                           |
| Updating `generatePrismaClient.js` client detection      | Still checks `node_modules/.prisma/client` on v6              |
| Docker template cleanup (`node_modules/.prisma` copy)    | Engine files still needed on v6                               |
| Serverless template cleanup (engine binary patterns)     | Engine files still needed on v6                               |
| `clean:prisma` script removal                            | `node_modules/.prisma/client` still the output location on v6 |
| `prisma.config.ts` `datasource.url` for env loading      | v7 CLI feature                                                |

---

## Resolved Considerations

1. **Data migration path alias** — Data migration files (`api/db/dataMigrations/*.ts`) correctly resolve `src/*` path aliases. Cedar's Babel configuration uses `babel-plugin-module-resolver` with the `root` set to the `api` base directory and an alias of `src: './src'`. This means `src/lib/db` is resolved relative to the `api` folder, so it works perfectly fine inside `api/db/dataMigrations/`. No relative paths are needed.

2. **Web side codegen imports** — The web `graphql.d.ts` currently imports `Prisma` from `@prisma/client` for scalar types (`Prisma.JsonValue`, `Prisma.JsonObject`). To ensure this resolves correctly to the API side's `db.ts` without conflicting with potential web-side files, we use the `$api/src/lib/db` alias.

3. **Framework package imports** — Several framework packages import from `@prisma/client` for their own code (not user code):
   - `packages/api/src/validations/validations.ts` — value import of `PrismaClient`
   - `packages/api/src/cache/index.ts` — dynamic `import('@prisma/client')`
   - `packages/storage/src/prismaExtension.ts` — imports from `@prisma/client`, `@prisma/client/extension`, `@prisma/client/runtime/library`
   - `packages/jobs/src/adapters/PrismaAdapter/PrismaAdapter.ts` — type import
   - `packages/auth-providers/dbAuth/api/src/DbAuthHandler.ts` — type import

   These are **framework** imports, not user code. They cannot use `src/lib/db` because they don't run in the context of a user project. They will continue importing from `@prisma/client` for now. Whether those sub-paths still work in Prisma v7 or how they instantiate the client (e.g., `new PrismaClient()` in `validations.ts`) will be addressed as part of the v7 PR.

4. **`@prisma/client` as a dependency** — After this migration, user projects will still have `@prisma/client` in their dependency tree (pulled in by `@cedarjs/api` and other framework packages). The package just won't be directly imported by user code anymore. This is fine for v6 and is also fine for v7 since framework packages will still depend on it.

---

## Testing Checklist

- [ ] `yarn build` passes
- [ ] `yarn test` passes (especially service generator tests after snapshot
      updates)
- [ ] `yarn test:types` passes
- [ ] Generating a new service (`yarn cedar generate service Foo`) produces
      files that import from `src/lib/db` instead of `@prisma/client`
- [ ] Generating a new scaffold produces files that work correctly (scaffolds
      don't import from `@prisma/client`, but verify no regressions)
- [ ] Generating a new data migration produces files with the updated import
- [ ] Running `yarn cedar dev` in a test project works (graphql codegen
      produces correct type files)
- [ ] The codemod correctly transforms a test project's imports
- [ ] Web side type generation works (Prisma scalar types resolve)
