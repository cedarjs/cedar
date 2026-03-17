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

Two decorators are used across the codebase:

- `@lazy()` — used on getters. Computes the value once and caches it on the
  instance. Used ~60 times across all model files and `nodes.ts`.
- `@memo()` — used on methods. Memoizes the return value. Used ~10 times.
  One usage passes a custom key serializer: `@memo(JSON.stringify)`.

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

No call sites outside `decorators.ts` need to change.

### Remove the decorator library dependencies

Remove from `package.json`:

- `lazy-get-decorator`
- `lodash-decorators`
- `lodash` (check whether anything else in the package uses it directly
  first — see Step 2)

---

## Step 2 — Audit remaining dependencies for CJS-only packages

Before switching the build, confirm that all runtime dependencies either
already ship ESM or are consumable under Node 24's `require(esm)`:

- `lodash` — used via `lodash-decorators` only. Once decorators are replaced,
  check whether any source file imports from `lodash` directly. If not, remove
  it along with `@types/lodash`.
- `dotenv-defaults` — verify it ships ESM or CJS (CJS is fine under Node 24).
- `enquirer` — verify same.
- All other deps (`ts-morph`, `smol-toml`, `graphql`, etc.) are known to ship
  ESM.

---

## Step 3 — Switch the build pipeline from Babel to tsc

### 3a — Update `tsconfig.json`

The current `tsconfig.json` sets `emitDeclarationOnly: true`, delegating JS
output to Babel. Remove that flag so tsc emits both JS and declarations:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "noImplicitReturns": false,
    "noImplicitAny": false,
    "noUnusedLocals": false
  },
  "include": ["src"],
  "references": [{ "path": "../project-config" }]
}
```

Check `tsconfig.base.json` — it already sets `"module": "esnext"` and
`"moduleResolution"` appropriately, so the emitted JS will use ESM `import`/
`export` statements natively.

### 3b — Add `"type": "module"` to `package.json`

```json
"type": "module"
```

This tells Node that all `.js` files in the package are ESM.

### 3c — Update `package.json` build scripts

Replace the Babel-based build with tsc:

```json
"build": "yarn build:js && yarn build:types",
"build:js": "tsc -p tsconfig.json",
"build:types": "tsc -p tsconfig.json --emitDeclarationOnly"
```

Since tsc will now emit both JS and `.d.ts` in one pass, these two steps can
actually be collapsed into one:

```json
"build": "tsc -p tsconfig.json",
"build:watch": "tsc -p tsconfig.json --watch"
```

Remove `build:types` as a separate step and update any Nx target configuration
that refers to it.

### 3d — Remove Babel dependencies from `package.json`

Remove from `devDependencies`:

- `@babel/cli`
- `@babel/core`

Remove the `core-js` and `@babel/runtime-corejs3` runtime deps (they are only
needed for Babel's polyfill injection — tsc doesn't add them).

Delete `.babelrc.js`.

### 3e — Add `.js` extensions to all internal imports

tsc with `"moduleResolution": "bundler"` or `"node16"` / `"nodenext"` requires
that relative imports in the source include the `.js` extension so they resolve
correctly in the emitted ESM output. Go through every file in `src/` and add
`.js` to all relative imports that are missing it:

```typescript
// Before
import { lazy, memo } from '../x/decorators'
// After
import { lazy, memo } from '../x/decorators.js'
```

This is mechanical but needs to be done across every file. A codemod or
`sed` pass can handle most of it:

```sh
find packages/structure/src -name '*.ts' | xargs sed -i \
  "s|from '\(\./[^']*\)'|from '\1.js'|g"
```

Verify the result and hand-fix any edge cases (re-exports, barrel files, etc.).

---

## Step 4 — Update `package.json` exports map

Add a proper `exports` field to replace the bare `"main"` entry and make
deep-path imports explicit:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./dist/model/RWProject.js": {
      "types": "./dist/model/RWProject.d.ts",
      "default": "./dist/model/RWProject.js"
    },
    "./dist/model/RWRoute.js": {
      "types": "./dist/model/RWRoute.d.ts",
      "default": "./dist/model/RWRoute.js"
    },
    "./dist/index.js": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

The deep-path subpath exports exist to support the current callers that
import directly from `dist/`. These callers can be cleaned up in a follow-on
PR, but including them in the exports map ensures nothing breaks immediately.

Current deep-path callers:

- `packages/cli/src/telemetry/resource.js` →
  `@cedarjs/structure/dist/model/RWProject`
- `packages/telemetry/src/sendTelemetry.ts` →
  `@cedarjs/structure/dist/model/RWProject`
- `packages/vite/src/lib/entries.ts` →
  `@cedarjs/structure/dist/index.js`,
  `@cedarjs/structure/dist/model/RWPage.js`,
  `@cedarjs/structure/dist/model/RWRoute.js`
- `packages/prerender/src/__tests__/detectRoutes.test.ts` →
  `@cedarjs/structure/dist/model/RWRoute` (type-only import, runtime-safe)

---

## Step 5 — Fix `packages/cli/src/commands/check.ts`

This file has a pre-existing bug that will surface during any testing of the
conversion:

```typescript
const { printDiagnostics, DiagnosticSeverity } = structure.default
```

`structure` has no default export, so `structure.default` is `undefined`. It
also has leftover debug `console.log` statements. This file needs to be
corrected to use named imports:

```typescript
const { printDiagnostics, DiagnosticSeverity } =
  await import('@cedarjs/structure')
```

And the `printDiagnostics` call signature needs updating to match the actual
function signature (it currently passes an object where it should pass
`getPaths().base` as the first argument).

This is a real bug fix rather than part of the ESM conversion, but it is
blocking and must be done in this PR.

---

## Step 6 — Remove `getProject()` `projectRoot` argument

As established separately, the `projectRoot` argument to `getProject()` is
unused in practice — `RWProject` never uses `this.opts.projectRoot` for path
resolution; it always goes through `getPaths()` which has its own fallback
chain. All callers either pass `getPaths().base` (which is exactly what the
fallback produces) or nothing.

Clean this up as part of this PR:

- Remove the `projectRoot` parameter from `getProject()`
- Remove `RWProjectOptions` interface (or simplify it)
- Remove `projectRoot` from `RWProject.opts` and `RWProject.projectRoot` getter
- Update the `new RWProject({ projectRoot })` constructor call in `index.ts`
- Update `cli/src/telemetry/resource.js` and `telemetry/src/sendTelemetry.ts`
  which both pass `{ projectRoot: getPaths().base }` directly to `new RWProject()`

---

## Step 7 — Verify tests pass

```sh
yarn build --filter=@cedarjs/structure
yarn test --filter=@cedarjs/structure
```

The test suite uses Vitest and sets `process.env.CEDAR_CWD` to point at
fixture projects, which is exactly how the `getConfigPath()` fallback chain
is exercised. No changes to the tests themselves should be needed.

Also run the broader affected package tests:

```sh
yarn test --filter=@cedarjs/internal
yarn test --filter=@cedarjs/prerender
yarn test --filter=@cedarjs/vite
```

---

## Summary of changes by file

| File                                      | Change                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/structure/src/x/decorators.ts`  | Replace with hand-written `lazy` and `memo` implementations                                               |
| `packages/structure/src/nodes.ts`         | No import changes needed                                                                                  |
| `packages/structure/src/model/*.ts`       | Add `.js` extensions to relative imports                                                                  |
| `packages/structure/src/x/*.ts`           | Add `.js` extensions to relative imports                                                                  |
| `packages/structure/src/index.ts`         | Remove `projectRoot` param from `getProject()`, add `.js` extensions                                      |
| `packages/structure/tsconfig.json`        | Remove `emitDeclarationOnly`, enable full emit                                                            |
| `packages/structure/package.json`         | Add `"type": "module"`, add `exports` map, replace build scripts, remove Babel and decorator library deps |
| `packages/structure/.babelrc.js`          | Delete                                                                                                    |
| `packages/cli/src/commands/check.ts`      | Fix broken `structure.default` usage and `printDiagnostics` call                                          |
| `packages/cli/src/telemetry/resource.js`  | Remove `projectRoot` from `new RWProject()` call                                                          |
| `packages/telemetry/src/sendTelemetry.ts` | Remove `projectRoot` from `new RWProject()` call                                                          |

No changes are required to any consuming package's module format. Node 24's
`require(esm)` support means CJS consumers continue to work with static
imports unchanged.
