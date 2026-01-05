# Upgrade Scripts

This directory contains scripts that are automatically executed by the CedarJS
CLI during an upgrade.

## Naming Convention

The CLI searches for scripts at three levels of specificity. **All matching
scripts found will be executed.**

For a user upgrading to `3.4.1`, the CLI checks for:

1.  **Exact Version:**
    - `3.4.1.ts` OR `3.4.1/index.ts`
2.  **Patch Wildcard (Same Minor Version):**
    - `3.4.x.ts` OR `3.4.x/index.ts`
3.  **Minor Wildcard (Same Major Version):**
    - `3.x.ts` OR `3.x/index.ts`

If a script exists for multiple levels (e.g., both `3.4.1.ts` and `3.x.ts`
exist), **both will be run**.

Within each level, the CLI prefers `.ts` files over `/index.ts` directories if
both happen to exist (but it stops at the first match for that level).

## How it works

When a user runs `cedar upgrade -t <version>`, the CLI checks the
`upgrade-scripts` directory in the `cedarjs/cedar` repository (on `main`
branch).

For each matching script found, the CLI:

1. Downloads the script.
2. Parses it for dependencies (imports and comments).
3. Installs dependencies in a temporary directory.
4. Executes the script using `node`.
5. Displays any output (stdout) to the user.

## Script Requirements

- Must be valid TypeScript (Node 24 compatible).
- Can import npm packages (they will be installed automatically).
- Should output information to `stdout`.
- Should exit with code 0 if successful, or non-zero if the upgrade should be
  aborted.

## Dependencies

Dependencies are automatically detected from `import` statements. By default,
the `latest` version is installed.

To specify a specific version, use a comment directive at the top of the file:

```typescript
// @dependency: lodash@4.17.21
// @dependency: @cedarjs/project-config@3.0.0
import memoize from 'lodash/memoize.js'
import { getConfig } from '@cedarjs/project-config'
```
