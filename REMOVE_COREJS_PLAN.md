# Plan: Remove core-js from CedarJS

## Background

CedarJS currently uses `core-js` in two distinct ways:

1. **`@babel/preset-env` with `useBuiltIns: 'usage'`** — Automatically injects `core-js` polyfill imports into source code based on the target environment (Node.js 20.10 for API side, `browserslist` "defaults" for web side).

2. **`@babel/plugin-transform-runtime` with `corejs: { version: 3, proposals: true }`** — Rewrites built-in references (e.g. `Promise`, `Symbol`, `Array.prototype.includes`) to import from `@babel/runtime-corejs3/core-js/...` instead of mutating globals.

The framework targets **Node.js 20.10+** on the API side and modern browsers (`"defaults"` browserslist) on the web side. New projects created with `create-cedar-app` require **Node.js 24.x**. Both of these environments natively support all ES2015–ES2023 features. The only things still being polyfilled are `esnext.*` stage 1–3 proposals and withdrawn proposals — none of which are used by the framework or recommended for user code.

---

## Impact Analysis

### Impact on the Framework Itself

#### Positive

- **Smaller build output for framework packages.** The `@babel/plugin-transform-runtime` currently rewrites every use of `Promise`, `Symbol`, `Map`, `Set`, `Array.prototype.includes`, etc. into imports from `@babel/runtime-corejs3`. Removing this eliminates thousands of unnecessary import rewrites in the transpiled output of framework packages like `@cedarjs/router`, `@cedarjs/web`, `@cedarjs/graphql-server`, and `@cedarjs/gqlorm`.
- **Faster builds.** Babel spends time resolving which polyfills to inject. Removing the core-js integration from both `preset-env` and `transform-runtime` reduces per-file transform time.
- **Reduced dependency weight.** `core-js` is ~1.5 MB on disk. `@babel/runtime-corejs3` pulls in `core-js-pure` (~1.5 MB). Removing both saves ~3 MB per install and reduces the attack surface.
- **Simpler babel configuration.** The `babel.config.js`, `packages/babel-config/src/common.ts`, `packages/babel-config/src/api.ts`, and `packages/babel-config/src/web.ts` all have core-js version extraction logic and configuration that can be deleted.
- **Eliminates a maintenance burden.** `core-js` must be kept in sync across 12+ `package.json` files. Its version is manually extracted and threaded through babel configs. The author of core-js has expressed plans for core-js 4 which would be a breaking change; removing the dependency avoids that migration entirely.

#### Negative / Risks

- **Polyfills for exotic ES Next proposals disappear.** The test suite in `packages/babel-config/src/__tests__/prebuildApiFile.test.ts` explicitly tests that proposals like `Reflect.metadata`, `compositeKey`, `Observable`, `Math.seededPRNG`, `Number.fromString`, etc. are polyfilled. These are all stage 1 or withdrawn proposals that are **not used anywhere in the framework source code** and are not expected to be used in user code. This is a non-risk in practice.
- **The `polyfill.js` test fixture becomes irrelevant.** The files at `__fixtures__/example-todo-main/api/src/lib/polyfill.js` and `packages/babel-config/src/__tests__/__fixtures__/redwood-app/api/src/lib/polyfill.js` are purely test fixtures that exercise core-js polyfilling. They will be removed.

### Impact on Existing Projects Using the Framework

#### Positive

- **Smaller `node_modules` and faster installs.** Existing projects won't need to download `core-js` or `@babel/runtime-corejs3` (and its transitive `core-js-pure`).
- **Smaller production bundles.** The web side currently has core-js polyfills injected via `preset-env` for prerender/Jest paths and via `transform-runtime` for API-side code. Removing these reduces bundle size for both API deploy artifacts and any SSR/prerender output.
- **No behavioral change for standard code.** All ES2015–ES2023 features (`Promise.any`, `String.replaceAll`, `AggregateError`, `Array.prototype.at`, `Object.hasOwn`, `structuredClone`, etc.) are natively available in Node.js 20+ and all modern browsers in the `"defaults"` browserslist.

#### Negative / Risks

- **Projects using exotic TC39 proposals would lose polyfills.** If any existing project relies on stage 1/2 proposals that core-js polyfilled (e.g. `Reflect.metadata`, `Observable`, `compositeKey`, `Math.seededPRNG`), those would break. This is extremely unlikely because:
  - These APIs are not documented or recommended by Cedar/Redwood.
  - They are not available in any runtime without core-js.
  - The TypeScript compiler does not emit types for them.
- **The prerender diagnostic check for "duplicate core-js" becomes irrelevant.** The check in `packages/cli/src/commands/prerenderHandler.ts` that looks for `web/node_modules/core-js` should be removed.

### Impact on New Projects

- **No impact.** New projects created with `create-cedar-app` do not have `core-js` in their `package.json` templates. The polyfilling was entirely a framework-internal concern. New projects targeting Node.js 24 have zero need for any polyfills.

---

## Execution Plan

### Phase 1: Remove core-js from `@babel/plugin-transform-runtime` configuration

This is the highest-impact change. It affects how all framework packages are built and how the API side of user projects is transpiled at dev/build time.

**Files to modify:**

1. **`packages/babel-config/src/api.ts`**
   - In `BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS`, remove the `corejs` key entirely (or set it to `false`). Remove the `version` key that references `@babel/runtime-corejs3`.
   - Remove the import/usage of `RUNTIME_CORE_JS_VERSION` from `./common`.

2. **`packages/babel-config/src/common.ts`**
   - Remove `CORE_JS_VERSION` constant and the `core-js` version extraction logic.
   - Remove `RUNTIME_CORE_JS_VERSION` constant and the `@babel/runtime-corejs3` version extraction logic.
   - Remove the two `throw new Error(...)` guards for these constants.

3. **`packages/babel-config/src/index.ts`**
   - Remove the deprecated exports for `BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS` and any core-js related re-exports.

4. **`packages/babel-config/src/web.ts`**
   - In `getWebSideBabelPresets`, remove the `corejs` option from the `@babel/preset-env` configuration. Change `useBuiltIns` from `'usage'` to `false` (since without core-js there's nothing to inject).

5. **`packages/babel-config/src/api.ts`**
   - In `getApiSideBabelPresets`, remove the `corejs` option from `@babel/preset-env`. Change `useBuiltIns` from `'usage'` to `false`.

6. **`babel.config.js` (root)**
   - Remove `CORE_JS_VERSION` extraction.
   - Remove `corejs` from `@babel/preset-env` options; set `useBuiltIns` to `false`.
   - Remove `corejs` from `@babel/plugin-transform-runtime` options.
   - Remove the `version` key referencing `@babel/runtime-corejs3`.

### Phase 2: Remove `core-js` and `@babel/runtime-corejs3` from all `package.json` files

**Remove `core-js` from `dependencies`/`devDependencies` in:**

- `package.json` (root, devDependencies)
- `packages/auth/package.json`
- `packages/auth-providers/dbAuth/setup/package.json`
- `packages/babel-config/package.json`
- `packages/cli/package.json`
- `packages/codemods/package.json`
- `packages/gqlorm/package.json`
- `packages/graphql-server/package.json`
- `packages/internal/package.json`
- `packages/router/package.json`
- `packages/vite/package.json`
- `packages/web/package.json`

**Remove `@babel/runtime-corejs3` from `dependencies`/`devDependencies` in:**

- `package.json` (root, devDependencies)
- `packages/auth-providers/dbAuth/setup/package.json`
- `packages/babel-config/package.json`
- `packages/cli/package.json`
- `packages/codemods/package.json`
- `packages/gqlorm/package.json`
- `packages/graphql-server/package.json`
- `packages/internal/package.json`
- `packages/router/package.json`
- `packages/web/package.json`

Then run `yarn install` to update the lockfile.

### Phase 3: Update / remove tests

1. **`packages/babel-config/src/__tests__/prebuildApiFile.test.ts`**
   - Remove or rewrite the entire `polyfills unsupported functionality` describe block (lines ~20–401). These tests assert that core-js polyfill imports are injected — which will no longer happen.
   - Remove the `uses core-js3 aliasing` describe block (lines ~403–433).
   - Remove the `core-js polyfill list` test (lines ~459–552).
   - Remove the `import compat from 'core-js-compat'` import.
   - Remove the import of `BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS`.
   - Keep the `typescript`, `auto imports`, and `source maps` tests — they are unrelated to core-js.

2. **`packages/babel-config/src/__tests__/api.test.ts`**
   - Remove or update the test `it can include '@babel/preset-env'` that asserts on `corejs` version and options (lines ~60–100).
   - Update the `it returns babel plugins` test to not expect `corejs` in the transform-runtime options (lines ~200–206).

3. **`packages/babel-config/dist.test.ts`**
   - Update the snapshot that exports `CORE_JS_VERSION`, `RUNTIME_CORE_JS_VERSION`, and `BABEL_PLUGIN_TRANSFORM_RUNTIME_OPTIONS`.

4. **`packages/vite/src/plugins/__tests__/vite-plugin-rsc-transform-client.test.ts`**
   - Update the inline CJS snapshot string that references `@babel/runtime-corejs3`. This test uses a hardcoded string of pre-built CJS output — it will need to be regenerated with a build that no longer includes runtime-corejs3 imports.

### Phase 4: Remove test fixtures

- Delete `packages/babel-config/src/__tests__/__fixtures__/redwood-app/api/src/lib/polyfill.js`
- Delete `packages/babel-config/src/__tests__/__fixtures__/redwood-app/api/src/lib/transform.js`
- Delete `__fixtures__/example-todo-main/api/src/lib/polyfill.js`

### Phase 5: Clean up ancillary references

1. **`packages/cli/src/commands/prerenderHandler.ts`**
   - Remove the diagnostic check for "Duplicate core-js version found in web/node_modules" (~lines 288–293).

2. **`packages/babel-config/dependencyGraph.dist.svg`**
   - Regenerate this file (via `yarn generate-dependency-graph` or equivalent) so it no longer shows `core-js` / `runtime-corejs3` nodes.

### Phase 6: Validate

1. `yarn install`
2. `yarn build:clean` — verify all packages build without errors.
3. `yarn test` — run the full test suite, expect the modified tests to pass.
4. `yarn lint` — ensure no lint errors.
5. `yarn e2e` — run the end-to-end tests to confirm no regressions in a real project.
6. Manually test `yarn create cedar-app` to confirm new projects work without core-js.

---

## Summary of Packages Affected

| Package                      | `core-js` | `@babel/runtime-corejs3` | Changes needed                           |
| ---------------------------- | --------- | ------------------------ | ---------------------------------------- |
| Root `package.json`          | devDep    | devDep                   | Remove both                              |
| `@cedarjs/babel-config`      | dep       | dep                      | Remove both, update source & tests       |
| `@cedarjs/auth`              | dep       | —                        | Remove `core-js`                         |
| `@cedarjs/auth-dbauth-setup` | dep       | dep                      | Remove both                              |
| `@cedarjs/cli`               | dep       | dep                      | Remove both, remove prerender diagnostic |
| `@cedarjs/codemods`          | dep       | dep                      | Remove both                              |
| `@cedarjs/gqlorm`            | dep       | dep                      | Remove both                              |
| `@cedarjs/graphql-server`    | dep       | dep                      | Remove both                              |
| `@cedarjs/internal`          | dep       | dep                      | Remove both                              |
| `@cedarjs/router`            | dep       | dep                      | Remove both                              |
| `@cedarjs/vite`              | dep       | —                        | Remove `core-js`                         |
| `@cedarjs/web`               | dep       | dep                      | Remove both                              |

**Total: 12 packages to update, ~550 lines of test code to remove, ~50 lines of config to simplify.**
