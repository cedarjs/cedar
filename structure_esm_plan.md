# Plan: Convert `@cedarjs/structure` to ESM-only

## Background

The `structure` package is currently built with Babel, which transpiles its
TypeScript source down to CommonJS. It is the last package in the monorepo
still using Babel for its JS output. The goal is to convert it to ESM-only,
using tsc for the JS build (as the rest of the monorepo already does), and
to remove all decorator library dependencies in favour of plain TypeScript
patterns.

Node 24 supports `require(esm)` stably (landed in Node 22.12), so CJS
consumers of this package do not need to be changed.

---

## Step 1 — Replace decorator libraries with plain TypeScript helpers

This is the most labour-intensive step and should be done first, while the
build pipeline is still intact, so that tests keep passing throughout.

Three decorators are re-exported from `src/x/decorators.ts`, but only two
are actually used:

- `@lazy()` — used on getters. Computes the value once and caches it on the
  instance. Used ~90 times across 13 model files and `nodes.ts`.
- `@memo()` — used on methods. Memoizes the return value. Used 8 times
  across 3 files (`nodes.ts`, `RWRouter.ts`, `RWProject.ts`).
  One usage passes a custom key serializer: `@memo(JSON.stringify)`.
- `@debounce` — re-exported but **never used anywhere**. Drop it.

### Replace `@lazy()` with a `lazy()` helper function

Rather than a decorator, implement a standalone helper that wraps a getter
with an own-property cache:

```typescript
// packages/structure/src/x/decorators.ts

export function lazy<T>(
  target: object,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<T>,
): TypedPropertyDescriptor<T> {
  const getter = descriptor.get
  if (!getter) {
    throw new Error(`@lazy() can only be used on getters`)
  }
  return {
    get(this: Record<string | symbol, T>) {
      const value = getter.call(this)
      Object.defineProperty(this, key, {
        value,
        enumerable: descriptor.enumerable,
      })
      return value
    },
    enumerable: descriptor.enumerable,
    configurable: true,
  }
}
```

This is a direct implementation of the lazy-get-decorator pattern with no
external dependency and is fully compatible with TypeScript's
`experimentalDecorators` mode (which is already enabled in `tsconfig.json`).

### Replace `@memo()` with a `memo()` helper function

Implement a method memoization helper that caches results in a `Map` keyed
by a serialized form of the arguments:

```typescript
// packages/structure/src/x/decorators.ts

export function memo(keySerializer: (...args: unknown[]) => string = String) {
  return function (
    _target: object,
    _key: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value
    return {
      ...descriptor,
      value(
        this: { __memoCache?: Map<string | symbol, Map<string, unknown>> },
        ...args: unknown[]
      ) {
        if (!this.__memoCache) {
          this.__memoCache = new Map()
        }
        const cacheKey = _key
        if (!this.__memoCache.has(cacheKey)) {
          this.__memoCache.set(cacheKey, new Map())
        }
        const methodCache = this.__memoCache.get(cacheKey)!
        const argsKey = keySerializer(...args)
        if (methodCache.has(argsKey)) {
          return methodCache.get(argsKey)
        }
        const result = original.apply(this, args)
        methodCache.set(argsKey, result)
        return result
      },
    }
  }
}
```

The one usage with a custom serializer (`@memo(JSON.stringify)` on
`collectDiagnostics`) passes cleanly as `@memo((...args) =>
JSON.stringify(args))`.

### Update all call sites

After updating `src/x/decorators.ts`, the import in every model file stays
identical:

```typescript
import { lazy, memo } from '../x/decorators'
```

No call sites outside `decorators.ts` need to change. The `@debounce`
re-export is simply dropped since it has zero consumers.

### Remove the decorator library dependencies

Remove from `package.json`:

- `lazy-get-decorator`
- `lodash-decorators`
- `lodash` (confirmed: no source file in `packages/structure/src/` imports
  from `lodash` directly — it is only a transitive dependency of
  `lodash-decorators`)
- `@types/lodash` (devDependency)

---

## Step 2 — Audit remaining dependencies for CJS-only packages

Before switching the build, confirm that all runtime dependencies either
already ship ESM or are consumable under Node 24's `require(esm)`:

- `lodash` — used via `lodash-decorators` only. No direct imports exist.
  Remove it along with `@types/lodash` (see Step 1).
- `dotenv-defaults` — **not imported anywhere** in `packages/structure/src/`.
  This is an orphaned dependency. Remove it.
- `enquirer` — **not imported anywhere** in `packages/structure/src/`.
  This is an orphaned dependency. Remove it.
- All other deps (`ts-morph`, `smol-toml`, `graphql`, etc.) are known to ship
  ESM.

---

## Step 3 — Switch the build pipeline from Babel to tsc

### 3a — Update `tsconfig.json`

The base `tsconfig.base.json` sets `"emitDeclarationOnly": true`, which
means tsc only emits `.d.ts` files — no JavaScript. The current structure
`tsconfig.json` does **not** override this flag (the JS build was entirely
delegated to Babel).

To make tsc emit both JS and declarations, we must **explicitly set
`"emitDeclarationOnly": false`** in the structure tsconfig to override the
base config's `true` value. Simply omitting the field would inherit `true`
from the base and produce no JS output at all.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "emitDeclarationOnly": false,
    "experimentalDecorators": true,
    "noImplicitReturns": false,
    "noImplicitAny": false,
    "noUnusedLocals": false
  },
  "include": ["src"],
  "references": [{ "path": "../project-config" }]
}
```

The base `tsconfig.base.json` already sets `"module": "esnext"` and
`"target": "esnext"`, so the emitted JS will use ESM `import`/`export`
statements natively.

### 3b — Add `"type": "module"` to `package.json`

```json
"type": "module"
```

This tells Node that all `.js` files in the package are ESM.

### 3c — Update `package.json` build scripts

Replace the Babel-based build with tsc. Since tsc will now emit both JS and
`.d.ts` in one pass, the two-step build can be collapsed:

```json
"build": "tsc -p tsconfig.json",
"build:watch": "tsc -p tsconfig.json --watch"
```

Remove `build:types` as a separate step and update any Nx target
configuration that refers to it.

### 3d — Remove Babel dependencies from `package.json`

Remove from `devDependencies`:

- `@babel/cli`
- `@babel/core`

Remove the `core-js` and `@babel/runtime-corejs3` runtime deps (they are
only needed for Babel's polyfill injection — neither is referenced anywhere
in the hand-written source code; they are injected at compile time by
Babel's transform). Confirmed: zero import/require references to either
package in `packages/structure/src/`.

Delete `.babelrc.js`.

### 3e — Add `.js` extensions to all internal imports

**Why this is needed:** The base `tsconfig.base.json` uses
`"moduleResolution": "node"` (the classic/legacy algorithm), which does
**not** require file extensions — tsc will happily resolve `'./foo'` to
`./foo.ts` and will not error on extensionless imports. However, at
**runtime** under Node.js ESM (with `"type": "module"` in `package.json`),
the Node ESM loader **does** require explicit file extensions on relative
imports. So even though tsc won't enforce this, the emitted `.js` files
would fail at runtime without `.js` extensions.

This means tsc **cannot catch missing extensions** for us. A manual audit
or a runtime smoke test is required to verify completeness.

Go through every file in `src/` and add `.js` to all relative imports that
are missing it:

```typescript
// Before
import { lazy, memo } from '../x/decorators'
// After
import { lazy, memo } from '../x/decorators.js'
```

Also update barrel re-exports (e.g. `src/model/index.ts`):

```typescript
// Before
export { RWProject } from './RWProject'
export { RWRoute } from './RWRoute'
// After
export { RWProject } from './RWProject.js'
export { RWRoute } from './RWRoute.js'
```

This is mechanical but needs to be done across every file. A codemod or
`sed` pass can handle most of it:

```sh
find packages/structure/src -name '*.ts' | xargs sed -i '' \
  "s|from '\(\./[^']*\)'|from '\1.js'|g"
```

**Note:** On macOS, `sed -i` requires an empty string argument (`-i ''`).
Verify the result and hand-fix any edge cases (re-exports, barrel files
that import from directories, etc.).

---

## Step 4 — Update `package.json` exports map

Add a proper `exports` field to replace the bare `"main"` entry and make
deep-path imports explicit.

There are two variants of deep-path imports in use across the monorepo:
some callers use `.js` extensions and some don't. Both must be supported in
the exports map to avoid breakage:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./dist/index.js": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./dist/model/RWProject": {
      "types": "./dist/model/RWProject.d.ts",
      "default": "./dist/model/RWProject.js"
    },
    "./dist/model/RWProject.js": {
      "types": "./dist/model/RWProject.d.ts",
      "default": "./dist/model/RWProject.js"
    },
    "./dist/model/RWRoute": {
      "types": "./dist/model/RWRoute.d.ts",
      "default": "./dist/model/RWRoute.js"
    },
    "./dist/model/RWRoute.js": {
      "types": "./dist/model/RWRoute.d.ts",
      "default": "./dist/model/RWRoute.js"
    },
    "./dist/model/RWPage.js": {
      "types": "./dist/model/RWPage.d.ts",
      "default": "./dist/model/RWPage.js"
    }
  }
}
```

The deep-path subpath exports exist to support the current callers that
import directly from `dist/`. These callers can be cleaned up in a follow-on
PR, but including them in the exports map ensures nothing breaks immediately.

Current deep-path callers:

- `packages/cli/src/telemetry/resource.js` →
  `@cedarjs/structure/dist/model/RWProject` (no extension)
- `packages/telemetry/src/sendTelemetry.ts` →
  `@cedarjs/structure/dist/model/RWProject` (no extension)
- `packages/vite/src/lib/entries.ts` →
  `@cedarjs/structure/dist/index.js`,
  `@cedarjs/structure/dist/model/RWPage.js`,
  `@cedarjs/structure/dist/model/RWRoute.js`
- `packages/prerender/src/__tests__/detectRoutes.test.ts` →
  `@cedarjs/structure/dist/model/RWRoute` (type-only, no extension)
- `packages/internal/src/__tests__/routes-mocked.test.ts` →
  `vi.mock('@cedarjs/structure/dist/model/RWRoute', ...)` (no extension)

**Note:** `RWPage` is **not** currently exported from the public barrel
(`src/index.ts`). That's why `entries.ts` uses a deep-path import. Consider
adding `RWPage` to the barrel export in a follow-on PR to allow cleaning up
that deep import.

---

## Step 5 — Fix `packages/cli/src/commands/check.ts`

This file has a pre-existing bug that will surface during any testing of the
conversion. The actual current code is:

```typescript
const { printDiagnostics } = await import('@cedarjs/structure')
// @ts-expect-error - babel-compiler enum issue. Keeping this as a separate
// import to preserve type information for printDiagnostics
const { DiagnosticSeverity } = (await import('@cedarjs/structure')).default
```

The `printDiagnostics` import on line 14 is correct. The problem is line 17:
`DiagnosticSeverity` is extracted from `.default`, which is a workaround for
a Babel CJS interop issue with enums. Once the structure package emits
native ESM, `.default` will be `undefined` and this will break.

The fix is to import `DiagnosticSeverity` as a normal named export:

```typescript
const { printDiagnostics, DiagnosticSeverity } =
  await import('@cedarjs/structure')
```

The `printDiagnostics` call later in the file passes the correct arguments
(an options object with `getSeverityLabel`) which matches the actual
function signature `printDiagnostics(opts?: { getSeverityLabel? })`. No
change needed to the call site itself.

---

## Step 6 — Clean up dead `projectRoot` argument in telemetry

The `getProject()` function in `src/index.ts` already takes **zero
arguments** and `RWProject` has **no constructor** that accepts options.
There is no `RWProjectOptions` interface, no `opts` property, and no
`projectRoot` getter to remove — these have already been cleaned up (or
never existed in this version of the code).

However, one caller still passes a dead argument:

- `packages/cli/src/telemetry/resource.js` line 79 does:
  `new RWProject({ projectRoot: getPaths().base })` — the argument is
  **silently ignored** since `BaseNode` has no constructor.

Clean this up: change it to `new RWProject()` (matching
`packages/telemetry/src/sendTelemetry.ts` which already passes no args).

This is a minor cleanup, not a structural change.

---

## Step 7 — Verify tests pass

```sh
yarn build --filter=@cedarjs/structure
yarn test --filter=@cedarjs/structure
```

The test suite uses Vitest and sets `process.env.CEDAR_CWD` to point at
fixture projects, which is exactly how the `getConfigPath()` fallback chain
is exercised. No changes to the tests themselves should be needed.

**Important:** Because tsc with `"moduleResolution": "node"` will not catch
missing `.js` extensions (see Step 3e), run a quick runtime smoke test after
the build to verify all imports resolve:

```sh
node -e "import('@cedarjs/structure').then(m => console.log(Object.keys(m)))"
```

Also run the broader affected package tests:

```sh
yarn test --filter=@cedarjs/internal
yarn test --filter=@cedarjs/prerender
yarn test --filter=@cedarjs/vite
```

---

## Summary of changes by file

| File                                     | Change                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/structure/src/x/decorators.ts` | Replace with hand-written `lazy` and `memo` implementations; drop unused `debounce` re-export             |
| `packages/structure/src/nodes.ts`        | No import changes needed (add `.js` extensions only)                                                      |
| `packages/structure/src/model/*.ts`      | Add `.js` extensions to relative imports                                                                  |
| `packages/structure/src/model/index.ts`  | Add `.js` extensions to barrel re-exports                                                                 |
| `packages/structure/src/x/*.ts`          | Add `.js` extensions to relative imports                                                                  |
| `packages/structure/src/index.ts`        | Add `.js` extensions to relative imports                                                                  |
| `packages/structure/tsconfig.json`       | Add `"emitDeclarationOnly": false` to override base config                                                |
| `packages/structure/package.json`        | Add `"type": "module"`, add `exports` map, replace build scripts, remove Babel and decorator library deps |
| `packages/structure/.babelrc.js`         | Delete                                                                                                    |
| `packages/cli/src/commands/check.ts`     | Remove `.default` workaround for `DiagnosticSeverity` import                                              |
| `packages/cli/src/telemetry/resource.js` | Remove dead `{ projectRoot }` argument from `new RWProject()` call                                        |

### Dependencies to remove from `packages/structure/package.json`

**`dependencies`:**

- `@babel/runtime-corejs3`
- `core-js`
- `lazy-get-decorator`
- `lodash`
- `lodash-decorators`
- `dotenv-defaults` (orphaned — zero imports in source)
- `enquirer` (orphaned — zero imports in source)

**`devDependencies`:**

- `@babel/cli`
- `@babel/core`
- `@types/lodash`

No changes are required to any consuming package's module format. Node 24's
`require(esm)` support means CJS consumers continue to work with static
imports unchanged.
