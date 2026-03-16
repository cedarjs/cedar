# Vite 6 Upgrade Plan

This document outlines the steps to upgrade CedarJS from Vite 5 to Vite 6.

## Overview

Vite 6 introduces a new experimental Environment API, updates to the Runtime API
(now Module Runner API), and several breaking changes in default configurations.

## 1. Preparation

- [x] Research all Vite usage in the monorepo (`grep -r "vite" .`).
- [x] Identify which packages are affected:
  - Root `package.json`
  - `packages/prerender/package.json`
  - `packages/ogimage-gen/package.json`
  - `packages/create-cedar-app/templates/`
  - `packages/vite/package.json`
  - `packages/storybook/package.json`
  - `__fixtures__/esm-test-project/package.json`

## 2. Implementation Steps

### 2.1 Update Dependencies

- [x] Update `vite` to `6.3.7` in all `package.json` files.
- [x] Update `postcss-load-config` to `v6` (if used directly).
- [x] Update `@rollup/plugin-commonjs` to `v28` (if used directly).

### 2.2 Configuration Updates

#### Resolve Conditions

- [x] Check `vite.config.ts` files for `resolve.conditions` or `ssr.resolve.conditions`.
- [x] If custom conditions are used, include `...defaultClientConditions` or `...defaultServerConditions`.
  - `resolve.conditions` now defaults to `['module', 'browser', 'development|production']`.
  - `ssr.resolve.conditions` now defaults to `['module', 'node', 'development|production']`.

#### JSON Stringify

- [x] If `json.stringify: true` was set to disable named exports, manually set `json.namedExports: false`.
- [x] Review large JSON files; Vite 6 now defaults to `json.stringify: 'auto'`.

#### Sass API

- [x] Vite 6 uses the modern Sass API by default.
- [x] If the legacy API is required, set `css.preprocessorOptions.sass.api: 'legacy'`.
- [x] Plan migration to the modern Sass API.

#### PostCSS

- [x] Ensure `tsx` or `jiti` is installed if using TypeScript for PostCSS config.
- [x] Ensure `yaml` is installed if using YAML for PostCSS config.

#### Library Mode CSS

- [x] In library mode, the CSS output filename now follows the `package.json` name.
- [x] Update any references to `style.css` in `package.json` `exports` or other files.
- [x] Use `build.lib.cssFileName: 'style'` to maintain the old behavior if preferred.

#### Rollup / CommonJS

- [x] `commonjsOptions.strictRequires` is now `true` by default. Verify if any CommonJS entry points need adjustments.

#### Globs

- [x] Migration from `fast-glob` to `tinyglobby` means range braces (e.g., `{01..03}`) are no longer supported. Audit glob patterns.

### 2.3 Codebase Changes

- [x] Update any usage of the experimental `Vite Runtime API` to the new `Module Runner API`.
- [x] Check for any default imports of CSS files in SSR dev mode (no longer supported).
- [ ] Audit `server.proxy[path].bypass` usage for WebSocket upgrade compatibility.
- [ ] **Note on SSR HMR:** Updates to SSR-only modules no longer trigger full page reloads in the client by default. Verify if this impacts existing developer workflows and implement a custom Vite plugin if the old behavior is still desired.

## 3. Verification & Validation

### 3.1 Framework Build & Test

- [x] Run `yarn build` to ensure all packages compile.
- [ ] Run `yarn lint` to check for style or configuration errors.
- [x] Run `yarn test` to execute unit tests.

### 3.2 Fixture Verification

- [x] Run `yarn rebuild-test-project-fixture` to update and verify the test project fixture.

### 3.3 Integration Testing

- [x] Run `yarn build:pack`.
- [ ] Navigate to `/test-project`:
  - [x] Run `yarn install`.
  - [ ] Run `yarn cedar build` (verify build output).
  - [ ] Run `yarn cedar dev` (verify development server and HMR).
  - [ ] Run `yarn cedar test` (verify integration tests).

## 4. Finalization

- [x] Commit changes.
- [x] Update `.changesets/release_notes_major.md` with anything that should be included in the release notes. For people with existing Cedar apps
