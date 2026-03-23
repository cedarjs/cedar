# Specification: Vite 5 to Vite 6 Upgrade for CedarJS

## 1. Objective

Migrate the CedarJS framework from Vite 5.4 to Vite 6.3.7, adopting new APIs and
ensuring compatibility with breaking changes.

## 2. Technical Requirements

### 2.1 Dependency Updates

- **Vite:** Bump `vite` from `5.4.21` to `6.3.7` in all `package.json` files.
- **Rollup Plugins:** Update `@rollup/plugin-commonjs` to `v28` (if used) to match Vite 6 defaults.
- **PostCSS:** Since no TypeScript/YAML PostCSS configs were found, no new dependencies (`jiti`, `tsx`, `yaml`) are strictly required, but templates should be documented for users who might use them.

### 2.2 Core Framework Changes (packages/vite)

#### 2.2.1 Module Runner API Migration

Vite 6 replaces the experimental `ViteRuntime` API with the `Module Runner` API.

- **Affected Files:** `packages/vite/src/devFeServer.ts` and `packages/vite/ambient.d.ts`.
- **Change:**
  - Replace `createViteRuntime` with `createViteModuleRunner` (or equivalent as per Vite 6 docs).
  - Update `ViteRuntime` types to `ModuleRunner`.
  - Ensure `globalThis.__rwjs__vite_ssr_runtime` and `globalThis.__rwjs__vite_rsc_runtime` are updated to the new types.

#### 2.2.2 Sass API Adoption

- **Policy:** Explicitly adopt the modern Sass API.
- **Action:** If any internal tests or future-proofed configs exist, ensure they don't rely on the legacy API. While Vite 6 defaults to `modern`, we will ensure compatibility in our internal `collectCss.ts` logic if it interacts with preprocessors.

#### 2.2.3 Resolve Conditions

- **Audit:** Ensure any internal Vite server creation (e.g., in `devFeServer.ts`) respects the new default `resolve.conditions`:
  - SSR: `['module', 'node', 'development|production']`
  - Client: `['module', 'browser', 'development|production']`

### 2.3 Template & Scaffolding Updates (packages/create-cedar-app)

- Update `vite.config.ts` templates to ensure they are compatible with Vite 6.
- If users have custom `resolve.conditions`, they will need to include `...defaultClientConditions` or `...defaultServerConditions`.

## 3. Implementation Plan

### 3.1 Phase 1: Research & Discovery (Completed)

- Identified `ViteRuntime` usage in `packages/vite`.
- Verified no TS/YAML PostCSS configs are present.
- Confirmed no explicit library mode usage for framework packages.

### 3.2 Phase 2: Implementation

- [ ] Bulk update `package.json` files.
- [ ] Refactor `packages/vite/src/devFeServer.ts` to use `ModuleRunner`.
- [ ] Update types in `packages/vite/ambient.d.ts`.
- [ ] Update templates in `packages/create-cedar-app` and `packages/cli`.

### 3.3 Phase 3: Validation

- [ ] **Build:** `yarn build`.
- [ ] **Lint:** `yarn lint`.
- [ ] **Test:** `yarn test` (Unit tests for all packages).
- [ ] **Fixture Sync:** `yarn rebuild-test-project-fixture`.
- [ ] **Integration:**
  - `yarn build:pack`.
  - In `/test-project`:
    - `yarn install`.
    - `yarn cedar build`.
    - `yarn cedar dev`.
    - `yarn cedar test`.

## 4. Risks & Mitigations

- **Breaking API Changes:** The `Module Runner` API is the most significant change.
  - _Mitigation:_ Refer to the official [Vite 6 Environment API documentation](https://vite.dev/guide/api-environment) during implementation.
- **SSR HMR:** SSR-only updates no longer trigger full page reloads.
  - _Mitigation:_ Manually verify that HMR still works as expected in the `test-project` dev server.
- **CommonJS:** `strictRequires` defaults to `true`.
  - _Mitigation:_ Watch for "is not a function" errors in SSR/Dev mode, which might indicate a CJS/ESM interop issue that needs `commonjsOptions` adjustment.
