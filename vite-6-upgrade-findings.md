# Vite 6 Upgrade Findings

This file documents findings, decisions, and observations during the upgrade from Vite 5 to Vite 6.

## Initial Research

- [x] Create findings file.
- [x] Identify all Vite usage in the monorepo.
- [x] Identify `ViteRuntime` usage for migration to `Module Runner`.

## Implementation

- [x] Update `vite` to `6.3.7` in all `package.json` files.
- [x] Update `ViteRuntime` to `ModuleRunner` in `packages/vite` and `packages/router`.
- [x] Audit for breaking configuration changes (resolve conditions, JSON stringify, Sass API, PostCSS, Library mode, CommonJS, Globs).
  - No `resolve.conditions` or `ssr.resolve.conditions` found in `vite.config.ts`.
  - No `json.stringify: true` found.
  - No legacy Sass API usage found.
  - No `postcss.config.ts` found.
  - No glob range braces found.
  - No default imports of non-module CSS files found in SSR paths.

## Validation

- [x] Framework build successful.
- [x] Framework unit tests passed (`vite` and `router` packages).
- [x] Test project fixture rebuilt successfully.
- [x] Integration tests passed in `test-project`.
  - `yarn cedar build` successful.
  - `yarn cedar dev` verified (server startup and request handling).
  - `yarn cedar test` passed (all 23 test suites).
- [x] Fixed a pre-existing issue in `posts.test.ts` where uniqueness validation failed due to colliding test data.
