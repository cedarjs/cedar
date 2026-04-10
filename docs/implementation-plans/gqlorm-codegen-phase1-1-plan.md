# Task: Phase 1.1 — Build-Time ModelSchema Codegen (`generateGqlormArtifacts()`)

## Context

This is the next minimal self-contained piece of the
[gqlorm schema-aware fields plan](./gqlorm-schema-aware-fields-and-types-plan.md)
that can be fully implemented and tested end-to-end.

The previous task ([`gqlorm-configure-setup-task.md`](./gqlorm-configure-setup-task.md))
implemented `configureGqlorm()` and the `QueryBuilder.configure()` API. After
that task, the test project's `App.tsx` was updated to call `configureGqlorm()`
at startup — but the `ModelSchema` it passes is **hardcoded** with a comment
noting it should eventually come from codegen:

```ts
// We hardcode all of these for now, until we have codegen in place.
configureGqlorm({
  schema: {
    post: ['id', 'title', 'body', 'authorId', 'createdAt'],
    user: ['id', 'email', 'fullName', 'roles'],
    contact: ['id', 'name', 'email', 'message', 'createdAt'],
  },
})
```

**The core problem this task solves:**
Developers should not have to manually maintain a `ModelSchema` in their app
code. This schema should be derived automatically from the Prisma schema at
codegen time. This task adds a `generateGqlormArtifacts()` function to
`packages/internal` that reads the Prisma DMMF, applies visibility rules
(`@gqlorm hide` / `@gqlorm show` directives and sensitivity heuristics), and
writes `.cedar/gqlorm-schema.json`. That JSON can then be imported by `App.tsx`
and passed to `configureGqlorm()`.

---

## Scope

### Files to create

- `packages/internal/src/generate/gqlormSchema.ts` — implementation
- `packages/internal/src/__tests__/gqlormSchema.test.ts` — unit test suite

### Files to modify

- `packages/internal/package.json` — add `@prisma/internals` dependency
- `packages/internal/src/generate/generate.ts` — call `generateGqlormArtifacts()`
- `local-testing-project-live/web/src/App.tsx` — import from generated JSON instead of hardcoding
- `tasks/smoke-tests/live/tests/liveQuery.spec.ts` — extend with schema-aware field selection assertions

### Files NOT in scope (follow-up tasks)

- TypeScript scalar declaration file generation (Phase 1.2 — `web-gqlorm-models.d.ts`)
- Watch mode integration for `schema.prisma` changes (Phase 1.3 — `watch.ts`)
- Backend auto-generated resolvers (`buildGqlormSchema()`) — Phase 4
- Type-safe return values (`ScalarTypeForModel`, updated `ModelDelegate`) — Phase 3
- `cedar.toml` opt-in flag (`experimental.gqlorm.enabled`) — config task
- `UserExample` is intentionally not filtered out; extra models in the schema are harmless

---

## Implementation

### 1. Core logic — `buildModelSchema(dmmf)`

Create `packages/internal/src/generate/gqlormSchema.ts`.

Define a **pure helper** `buildModelSchema(dmmf: DMMF.Document): Record<string, string[]>`
that converts a Prisma DMMF document into a `ModelSchema`. Separating this from
I/O makes the function trivially unit-testable without hitting the filesystem or
the Prisma process.

#### Internal model names to skip

Always exclude these Cedar/Redwood internal migration models by name:

```ts
const INTERNAL_MODEL_NAMES = new Set([
  'RW_DataMigration',
  'Cedar_DataMigration',
])
```

#### Directive detection

A directive is recognised when it appears at the start of a line (after
optional whitespace) in the model or field `documentation` string:

```ts
function hasDirective(
  doc: string | undefined,
  directive: 'hide' | 'show'
): boolean {
  if (!doc) {
    return false
  }
  return doc
    .split('\n')
    .some((line) => line.trimStart().startsWith(`@gqlorm ${directive}`))
}
```

#### Sensitivity heuristic

A field is considered sensitive if its name (lowercased) contains any of these
substrings:

```ts
const SENSITIVE_PATTERNS = ['password', 'secret', 'token', 'hash', 'salt']
```

This matches `hashedPassword`, `salt`, `resetToken`, `resetTokenExpiresAt` in
the test project's `User` model, as well as common variants in other projects.

#### Field visibility rules (applied in order)

For each field where `field.kind === 'scalar'` or `field.kind === 'enum'`:

1. If `field.documentation` contains `@gqlorm hide` → **exclude**, no warning.
2. If `field.documentation` contains `@gqlorm show` → **include**, no warning.
3. If the field name matches a sensitivity pattern → **exclude**, emit a
   `console.warn()` to prompt the developer to add an explicit directive.
4. Otherwise → **include**.

Relation fields (`kind === 'object'`) and unsupported fields
(`kind === 'unsupported'`) are excluded unconditionally — no rule, no warning.

#### Sensitivity warning format

```
[gqlorm] User.hashedPassword was automatically hidden because its name appears sensitive.
Add a directive to suppress this warning:

  /// @gqlorm hide   — to confirm it should stay hidden
  /// @gqlorm show   — to explicitly expose it
```

#### Model visibility rules

A model is excluded from the schema if:

- Its name is in `INTERNAL_MODEL_NAMES`, OR
- Its `documentation` string contains `@gqlorm hide`.

#### Output format

The model schema is keyed by the **lowercased** model name:

```json
{
  "post": ["id", "title", "body", "authorId", "createdAt"],
  "user": ["id", "email", "fullName", "roles"],
  "contact": ["id", "name", "email", "message", "createdAt"],
  "userexample": ["id", "email", "name"]
}
```

(`userExample` is included as `userexample` — the extra model is harmless and
the frontend only uses the keys it references in `useLiveQuery` calls.)

### 2. I/O — `generateGqlormArtifacts()`

The async exported function:

1. Calls `getPrismaSchemas()` from `@cedarjs/project-config` to get the raw
   schema content (array of `[filePath, content]` tuples).
2. Dynamically imports `getDMMF` from `@prisma/internals` (using the same
   ESM/CJS interop pattern already used in `packages/project-config`):
   ```ts
   const mod = await import('@prisma/internals')
   const { getDMMF } = mod.default || mod
   ```
3. Calls `getDMMF({ datamodel: schemas })` to parse the schema.
4. Calls `buildModelSchema(dmmf)`.
5. Writes the JSON to `path.join(getPaths().generated.base, 'gqlorm-schema.json')`,
   creating the directory if needed.
6. Returns `{ files: string[], errors: Array<{ message: string; error: unknown }> }`
   — the same shape used by other generators in `generate.ts`.

Errors are caught and returned (not thrown) so that a Prisma parsing failure
does not abort the entire codegen pipeline.

### 3. Plug into `generate.ts`

In `packages/internal/src/generate/generate.ts`, import and call
`generateGqlormArtifacts()` alongside the other generators. Merge its
`files` and `errors` into the overall result:

```ts
const { files: gqlormFiles, errors: gqlormErrors } =
  await generateGqlormArtifacts()
```

### 4. Add `@prisma/internals` to `packages/internal`

Add `"@prisma/internals": "7.6.0"` to the `dependencies` section of
`packages/internal/package.json`. This version is already used by several other
packages in the monorepo (`packages/cli`, `packages/project-config`,
`packages/structure`).

### 5. Update `local-testing-project-live/web/src/App.tsx`

Replace the hardcoded schema object with an import from the generated JSON file.
The `.cedar/gqlorm-schema.json` file lives at the project root; from
`web/src/App.tsx`, the relative path is `../../.cedar/gqlorm-schema.json`:

```ts
import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import schema from '../../.cedar/gqlorm-schema.json'

configureGqlorm({ schema })
```

Remove the hardcoded `schema` object and its comment entirely.

> **Note:** The relative path `../../.cedar/gqlorm-schema.json` is correct —
> Vite's `root` is set to `web/src`, so `../../` from `web/src/App.tsx`
> traverses up to the project root. Improving the import path (e.g. via a Vite
> alias) is left for a follow-up DX task.

---

## Tests

### Unit tests — `packages/internal/src/__tests__/gqlormSchema.test.ts`

The tests exercise `buildModelSchema()` directly with hand-crafted mock DMMF
objects — no file system, no Prisma process required.

#### Test group: `buildModelSchema()`

- **Basic scalar field collection**
  Provide a DMMF with a single `Post` model having `id` (Int, scalar),
  `title` (String, scalar), and `author` (object/relation).
  Assert that the output is `{ post: ['id', 'title'] }` (relation excluded).

- **Enum fields are included**
  Provide a model with an `enum` field (`status`).
  Assert it appears in the output alongside scalar fields.

- **`@gqlorm hide` on a field excludes that field**
  Set `field.documentation = '@gqlorm hide'` on `body`.
  Assert `body` is absent from the output for that model.

- **`@gqlorm show` on a sensitive-named field includes it**
  Name a field `resetToken` and set `field.documentation = '@gqlorm show'`.
  Assert `resetToken` IS present in the output (show overrides the heuristic).

- **Sensitivity heuristic auto-hides matching fields**
  Add fields named `hashedPassword`, `salt`, `resetToken`, `secretKey`,
  `authToken` with no documentation.
  Assert none of them appear in the output.
  Assert a `console.warn` was emitted for each one (spy on `console.warn`).

- **`@gqlorm hide` on a sensitive field suppresses the warning**
  Name a field `hashedPassword` and set `documentation = '@gqlorm hide'`.
  Assert `hashedPassword` is absent AND no `console.warn` was emitted.

- **`@gqlorm hide` on a model excludes the entire model**
  Set `model.documentation = '@gqlorm hide'` on `Post`.
  Assert `post` is absent from the output entirely.

- **Internal Cedar/Redwood migration models are skipped**
  Include models named `RW_DataMigration` and `Cedar_DataMigration` alongside
  a normal `Contact` model.
  Assert neither `rw_datamigration` nor `cedar_datamigration` appear in the
  output, and `contact` is present.

- **Model names are lowercased in the output**
  Provide a model named `BlogPost`.
  Assert the key in the output is `blogpost` (not `BlogPost`).

- **Multiline documentation is handled correctly**
  Set `model.documentation` to a multiline string where `@gqlorm hide` appears
  on the second line. Assert the directive is still recognised.

- **`unsupported` kind fields are excluded**
  Add a field with `kind: 'unsupported'` to a model.
  Assert it does not appear in the output.

### Integration test — `generateGqlormArtifacts()` with fixture project

Use `process.env.CEDAR_CWD = FIXTURE_PATH` pointing to
`__fixtures__/test-project-live`, similar to the pattern in
`packages/internal/src/__tests__/typeDefinitions.test.ts`.

- **`generateGqlormArtifacts()` writes `.cedar/gqlorm-schema.json`**
  After running the function against the `test-project-live` fixture:
  - Assert the output file exists at
    `path.join(getPaths().generated.base, 'gqlorm-schema.json')`.
  - Parse and assert it is valid JSON.
  - Assert `post` key exists and includes `title`, `body`, `authorId`,
    `createdAt`, `id`.
  - Assert `user` key exists and includes `email`, `fullName`, `roles`, `id`.
  - Assert `user` does NOT contain `hashedPassword`, `salt`, `resetToken`, or
    `resetTokenExpiresAt` (auto-hidden by heuristic).
  - Assert `contact` key exists with `name`, `email`, `message`.
  - Assert the `post` fields do NOT include `author` (relation field).
  - Assert `console.warn` was called for each auto-hidden sensitive field in
    `User`.

> Cleanup: use `afterAll` to delete the generated `gqlorm-schema.json` file so
> the fixture directory is not polluted between test runs.

### Playwright e2e tests — `tasks/smoke-tests/live/tests/liveQuery.spec.ts`

Add two new tests to the existing `liveQuery.spec.ts`:

- **`useLiveQuery` renders post body text (schema-aware field selection)**
  Navigate to `/live-query`.
  Assert that the body text snippet
  `'hoodie post-ironic paleo'` (part of the seeded post body) is visible.
  This assertion fails if `useLiveQuery` only selects `id` (id-only fallback)
  and passes only when the codegen-produced schema is loaded and
  `configureGqlorm()` is in effect, which causes `body` to be requested.

- **`useLiveQuery` renders `createdAt` field via schema-aware selection**
  Since `createdAt` is in the generated schema for `post`, update the
  `LivePosts` component to also render `createdAt` in the UI (a small addition
  to the component, e.g. a `<time>` element), then assert the rendered date
  is visible. If the field isn't in the schema, the component will not receive
  it and the assertion will fail.

  > **Note:** This requires a small update to `LivePosts.tsx` in the test
  > project to render `post.createdAt`.

---

## Acceptance Criteria

- [ ] `generateGqlormArtifacts()` exists in
      `packages/internal/src/generate/gqlormSchema.ts` and is called in
      `generate.ts`.
- [ ] Running `yarn cedar generate` in `local-testing-project-live` writes
      `.cedar/gqlorm-schema.json` with the correct field lists.
- [ ] The generated schema excludes relation fields and sensitive fields for the
      `User` model.
- [ ] `console.warn` is emitted during codegen for each auto-hidden sensitive
      field with no explicit directive.
- [ ] `local-testing-project-live/web/src/App.tsx` imports the schema from
      `../../.cedar/gqlorm-schema.json` instead of hardcoding it.
- [ ] All unit tests in `gqlormSchema.test.ts` pass.
- [ ] All pre-existing tests in `packages/internal` continue to pass.
- [ ] The `useLiveQuery hook renders posts` Playwright test continues to pass
      (regression guard).
- [ ] The two new Playwright tests that assert `body` and `createdAt` visibility
      pass.
- [ ] TypeScript compiles with no errors in `packages/internal`.

---

## Verification Steps

```sh
# Unit tests
cd packages/internal
yarn test

# Type check
yarn build:types

# E2E — from repo root, after yarn build:pack and install in test project
CEDAR_TEST_PROJECT_PATH=local-testing-project-live \
  yarn playwright test tasks/smoke-tests/live/tests/liveQuery.spec.ts
```

---

## What This Enables

Once this task is complete:

1. Running `yarn cedar generate` (which happens automatically in `yarn dev` and
   `yarn build`) writes `.cedar/gqlorm-schema.json` from the Prisma schema.
2. `App.tsx` imports that JSON and passes it to `configureGqlorm()` — no manual
   schema maintenance required.
3. `useLiveQuery((db) => db.post.findMany())` requests all visible scalar fields
   automatically, not just `id`.
4. The pipeline is:
   ```
   schema.prisma → yarn cedar generate → .cedar/gqlorm-schema.json
     → import in App.tsx → configureGqlorm({ schema })
     → useLiveQuery uses all visible scalar fields
   ```
5. Phase 1.2 (TypeScript declaration file generation) can now be implemented
   independently — it reuses the same DMMF parsing logic but writes a `.d.ts`
   file for type-safe return values.
