# Jest Setup Performance Notes

This note tracks low-risk follow-ups to reduce API test setup overhead.

## Current State

- `jest.setup.ts` uses dynamic imports to avoid loading heavy modules eagerly.
- `getPaths()` in `@cedarjs/project-config` is memoized per module context.
- In Jest, `setupFilesAfterEnv` runs in separate test-suite contexts, so caches are not shared across suites.

## Follow-Ups

1. Avoid repeated schema loading in `getQuoteStyle()`.
   `getQuoteStyle()` currently fetches Prisma schemas before checking cached `quoteStyle`.
   Move schema/config loading inside `if (!quoteStyle)`.

2. Share schema loading inside a suite context.
   Introduce a module-local `schemasPromise` in `jest.setup.ts` and reuse it in:

- `configureTeardown()`
- `getQuoteStyle()`

3. Measure impact before/after.
   Capture:

- average runtime of API test suites
- peak memory usage
- number of Prisma schema/config resolutions per suite
