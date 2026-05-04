# Plan: Remove Hardcoded `src/lib/db` Import from gqlorm (Babel Plugin with Smart DB Detection)

## Context

The gqlorm system currently relies on a Babel plugin
(`babel-plugin-cedar-gqlorm-inject.ts`) to inject a build-time import and an
`Object.assign(sdls, ...)` mutation into `api/src/functions/graphql.ts`:

```ts
import { db as __gqlorm_db__ } from 'src/lib/db'
import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'

Object.assign(sdls, {
  __gqlorm__: {
    schema: __gqlorm_sdl__.schema,
    resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
  },
})
```

This has two problems:

1. **`src/lib/db` is hardcoded.** Users who extract their database layer to a
   separate workspace package (e.g. `packages/db`) cannot use gqlorm without
   manually overriding the import path.

2. **The `.cedar/gqlorm/backend` import leaks into user space.** The Babel plugin
   computes a relative path from `graphql.ts` to the generated backend file and
   injects it directly into user code. This is fragile.

## Why Babel (not Vite)

After investigation, the API build pipeline has **two active paths**:

| Path     | Tool                          | Used by                                      |
| -------- | ----------------------------- | -------------------------------------------- |
| Vite SSR | `buildApiWithVite()`          | `cedar build api`, unified dev mode          |
| esbuild  | `buildApi()` / `rebuildApi()` | fallback dev mode (`cedar-api-server-watch`) |

**Both paths go through Babel.** The esbuild path calls `transformWithBabel()`
which applies `getApiSideBabelPlugins()` and `getApiSideBabelOverrides()`. The
Babel override specifically targets `api/src/functions/graphql.ts`.

A Vite plugin would only cover the Vite path. The esbuild fallback dev path
would completely miss gqlorm injection, breaking gqlorm for anyone using
fallback dev mode (api-only, web-only, custom serverFile, streaming SSR, etc.).

**Babel is the right layer for this transform because it runs in both build paths.**

---

## Revised Approach

Keep the Babel plugin architecture but rewrite it to:

1. **Detect the user's existing `db` import** in `graphql.ts` instead of injecting
   a hardcoded `import { db } from 'src/lib/db'`.
2. **Keep the `.cedar/gqlorm/backend` relative import computation** — this path
   is framework-controlled and already correct.
3. **Use the detected `db` identifier** in the injected `Object.assign(sdls, ...)`
   call.

**Before (current hardcoded injection):**

```ts
// Babel injects:
import { db as __gqlorm_db__ } from 'src/lib/db'
import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'

Object.assign(sdls, {
  __gqlorm__: {
    schema: __gqlorm_sdl__.schema,
    resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
  },
})
```

**After (smart detection):**

```ts
// User already has:
import { db } from '@myorg/db' // or 'src/lib/db', or any other path

// Babel injects:
import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'

Object.assign(sdls, {
  __gqlorm__: {
    schema: __gqlorm_sdl__.schema,
    resolvers: __gqlorm_sdl__.createGqlormResolvers(db), // uses user's identifier
  },
})
```

No `db` import is injected. The plugin finds whichever import in the file brings
`db` into scope and reuses that identifier.

---

## Goals

- Eliminate the hardcoded `src/lib/db` assumption from gqlorm's build pipeline.
- Extracted-DB apps work without any config change — if the user imports `db`
  in `graphql.ts`, the plugin finds it automatically.
- Keep the transform at the Babel layer so it runs in both Vite and esbuild paths.
- Existing apps with `api/src/lib/db.ts` require **zero changes**.

---

## Non-Goals

- Changing how users write their `graphql.ts` files. The default template stays
  the same; the plugin works with whatever `db` import the user already has.
- Adding `dbModule` to `cedar.toml` for gqlorm. The plugin detects `db` from the
  existing import graph.
- Switching to a Vite plugin. Babel covers both build paths; Vite would not.
- Changing the live query listener setup. `startLiveQueryListener()` remains a
  separate concern and a separate setup command injection.

---

## Changes

### 1. Rewrite `babel-plugin-cedar-gqlorm-inject` to detect existing `db` binding

**File:** `packages/babel-config/src/plugins/babel-plugin-cedar-gqlorm-inject.ts`

**Current behavior:** The plugin unconditionally injects:

```ts
import { db as __gqlorm_db__ } from 'src/lib/db'
```

**New behavior:** The plugin:

1. Uses Babel's scope analysis to find a **top-level binding named `db`** in the
   module. This catches named imports, default imports, and local declarations.
2. If no `db` binding exists, **throws a hard build error**. gqlorm is opt-in; if
   the user enabled it, the build must guarantee resolvers are wired up.
3. Uses the detected `db` identifier in the `Object.assign(sdls, ...)` call.

**Why a hard error (not a warning):**

- gqlorm is opt-in via `experimental.gqlorm.enabled = true`
- A silent skip means the build succeeds but queries return null at runtime
- A failed build with a clear message is infinitely better than a production bug

**Implementation sketch:**

```ts
function getTopLevelDbBinding(
  programPath: NodePath<types.Program>
): { name: string } | null {
  const binding = programPath.scope.getBinding('db')
  // Must exist and be defined at the top-level (module scope)
  if (binding && binding.scope.block.type === 'Program') {
    return { name: binding.identifier.name }
  }
  return null
}
```

Then in the main plugin logic:

```ts
const dbBinding = getTopLevelDbBinding(programPath)
if (!dbBinding) {
  throw new Error(
    `[gqlorm] Could not find a top-level 'db' binding in ${state.file.opts.filename}.\n\n` +
      `gqlorm requires a 'db' identifier to be available in the top-level scope ` +
      `of your GraphQL handler file. Expected something like:\n\n` +
      `  import { db } from 'src/lib/db'\n` +
      `  // or\n` +
      `  import { db } from '@myorg/db'\n`
  )
}

// Build the sdls mutation using the detected identifier:
const sdlsMutation = t.expressionStatement(
  t.callExpression(
    t.memberExpression(t.identifier('Object'), t.identifier('assign')),
    [
      t.identifier('sdls'),
      t.objectExpression([
        t.objectProperty(
          t.identifier('__gqlorm__'),
          t.objectExpression([
            t.objectProperty(
              t.identifier('schema'),
              t.memberExpression(
                t.identifier('__gqlorm_sdl__'),
                t.identifier('schema')
              )
            ),
            t.objectProperty(
              t.identifier('resolvers'),
              t.callExpression(
                t.memberExpression(
                  t.identifier('__gqlorm_sdl__'),
                  t.identifier('createGqlormResolvers')
                ),
                [t.identifier(dbBinding.name)] // <-- detected identifier
              )
            ),
          ])
        ),
      ]),
    ]
  )
)
```

**Important:** The `__gqlorm_db__` import injection is removed entirely. Only
the `__gqlorm_sdl__` import and the `Object.assign` call remain.

---

### 2. Keep the Babel override registration

**File:** `packages/babel-config/src/api.ts`

The existing Babel override stays exactly the same:

```ts
{
  test: /.+api(?:[\|/])src(?:[\|/])functions(?:[\|/])graphql\.(?:js|ts)$/,
  plugins: [pluginRedwoodGraphqlOptionsExtract, pluginCedarGqlormInject],
}
```

No changes needed here. The plugin runs in both the Vite and esbuild paths
because both call `transformWithBabel()` with the same `getApiSideBabelOverrides()`.

---

### 3. Add tests

**File:** `packages/babel-config/src/__tests__/babel-plugin-cedar-gqlorm-inject.test.ts`
(or create if it doesn't exist)

Test cases:

- **Default `db` import:** Given `import { db } from 'src/lib/db'` in the input,
  the plugin injects `Object.assign(sdls, { __gqlorm__: { ..., resolvers:
__gqlorm_sdl__.createGqlormResolvers(db) } })` — using the identifier `db`.

- **Aliased `db` import:** Given `import { db as prisma } from '@myorg/db'`,
  the plugin uses `prisma` in the resolver call.

- **No `db` binding:** The plugin **throws a build error** with a helpful message.

- **No `sdls` in scope:** The plugin still works (it mutates the `sdls` binding
  that the Babel glob-import plugin has already created). If `sdls` genuinely
  doesn't exist, `Object.assign(sdls, ...)` will throw at runtime — this is the
  same behavior as today.

- **Idempotency:** If the plugin runs twice (e.g. during watch rebuilds), it
  should not double-inject. Check for `__gqlorm_sdl__` or `__gqlorm__` already
  present and return early.

- **The plugin does NOT inject a `db` import:** Verify that the output does not
  contain `import { db as __gqlorm_db__ }` or any synthetic `db` import.

---

## Acceptance Criteria

- [ ] The Babel plugin detects the user's existing top-level `db` binding instead
      of hardcoding `src/lib/db`.
- [ ] The plugin handles aliased imports (`import { db as prisma }`).
- [ ] The plugin does not inject any synthetic `db` import.
- [ ] The plugin still correctly injects the `__gqlorm_sdl__` import and the
      `Object.assign(sdls, ...)` statement.
- [ ] If no top-level `db` binding is found, the plugin **throws a hard build
      error** with a clear, actionable message.
- [ ] The plugin is idempotent (does not double-inject on rebuilds).
- [ ] All existing babel-config tests pass.
- [ ] New unit tests cover smart `db` detection, aliasing, and the hard error path.
- [ ] Playwright smoke tests for live queries / gqlorm continue to pass.

---

## Verification Steps

```sh
# Run babel-config tests
cd packages/babel-config
yarn test

# Full test suite
yarn test

# Build and test in local-testing-project-live
cd local-testing-project-live
yarn cedar generate
yarn build

# Run Playwright smoke tests
cd ../tasks/smoke-tests/live
yarn playwright test tests/liveQuery.spec.ts
```

---

## What This Enables

- **No hardcoded `src/lib/db` assumption.** The plugin adapts to whatever `db`
  import the user already has in `graphql.ts`.
- **Works with extracted DB packages.** If the user moves their `db` export to
  `@myorg/db` and updates their `graphql.ts` import, the plugin automatically
  picks it up — no config needed.
- **Runs in both build paths.** Because the transform stays at the Babel layer,
  it works in both Vite SSR builds and esbuild fallback dev mode.
- **Zero changes for existing apps.** The default template has `import { db }
from 'src/lib/db'` — the plugin detects this and continues to work exactly as
  before.

---

## Migration Notes for Existing gqlorm Users

Existing apps that already have gqlorm enabled will see no visible change. The
updated Babel plugin replaces the old hardcoded behavior transparently:

- `graphql.ts` still imports `db` the same way
- `graphql.ts` still has `createGraphQLHandler({...})`
- The build pipeline injects the same `Object.assign(sdls, ...)` call, just
  using the detected `db` identifier instead of a hardcoded one

No manual migration is required.
