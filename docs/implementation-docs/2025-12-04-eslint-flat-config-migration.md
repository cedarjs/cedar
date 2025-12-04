# ESLint Flat Config Migration

**Date:** 2025-12-04  
**Status:** Complete

## Overview

Migrated CedarJS from legacy ESLint config (`.eslintrc.js`) to ESLint's new flat config format while maintaining backward compatibility.

## Technical Changes

### Package Structure

- **New files:** `index.mjs`, `shared.mjs` (flat config)
- **Preserved:** `index.js`, `shared.js` (legacy config)
- **Exports:** Package exports both ESM (flat) and CJS (legacy) formats
- **Deleted:** Root `.eslintrc.js` replaced with `eslint.config.mjs`

### Key Flat Config Differences

1. **No `env` property** - Must manually specify globals using `globals` package:

   ```js
   // Old: env: { browser: true, jest: true }
   // New: globals: { ...globals.browser, ...globals.jest }
   ```

2. **File patterns require globs** - `*.ts` → `**/*.ts` for nested files

3. **Config ordering matters** - Later configs override earlier ones

### Template Changes

- CJS templates: `eslint.config.mjs` (force ESM for top-level await)
- ESM templates: `eslint.config.js` (already have `"type": "module"`)
- Removed `eslintConfig` from `package.json`

### Ignore Patterns

- **Legacy:** `ignorePatterns` array in config object
- **Flat config:** First config object with `ignores` property (global ignores)

### Globals Migration

Flat config removed `env` property, requiring manual globals specification:

- Browser: confirm, HTMLInputElement, document, etc. (previously `env: { browser: true }`)
- Node.js: process, Buffer, \_\_dirname, etc. (previously `env: { node: true }`)
- Jest: describe, it, expect, etc. (previously `env: { jest: true }`)
- Cedar-specific: mockCurrentUser, defineScenario, scenario, etc.

Later improved by using `globals` package instead of manual lists.

### File Pattern Changes

- All patterns: Changed from simple (`*.ts`) to glob patterns (`**/*.ts`) for
  nested files
- Config files: Expanded to `**/*.config.{js,cjs,mjs}` patterns
- Test files: Include `**/*.scenarios.*`, `**/*.stories.*`, `**/*.mock.*`

### TypeScript Configuration Changes

- **Framework:**
  - Old: `@typescript-eslint/recommended-type-checked` with `project: './tsconfig.eslint.json'`
  - New: `typescript-eslint.configs.recommendedTypeChecked` with `project: './tsconfig.eslint.json'`
- **Projects:**
  - Old: `@typescript-eslint/recommended` without project config (not type-aware)
  - New: `typescript-eslint.configs.recommended` without project config (not type-aware)

## Compatibility

- **Non-breaking:** Legacy `.eslintrc.js` and `package.json` config still work
- **Migration optional:** Users can migrate when convenient
- **Behavior preserved:** Same linting rules and errors as before

## TypeScript Configuration Files

### ESLint Version Compatibility

While ESLint does support TypeScript configuration files, there's an important version dependency:

- **ESLint v9+** (flat config): Native TypeScript config support with auto-discovery
  - Supports `eslint.config.ts`, `eslint.config.mts`, `eslint.config.cts`
  - Auto-discovers these files after checking for JavaScript variants
  - No additional dependencies required with Node.js 24+

- **ESLint v8** (current CedarJS version): Limited TypeScript config support
  - TypeScript configs are **not** auto-discovered
  - Requires explicit `--config eslint.config.ts` flag
  - Would break seamless developer experience in generated apps

### Current Approach

CedarJS currently uses **ESLint v8.57.1**, so we continue using JavaScript config files:

- TypeScript templates use `eslint.config.mjs` (CJS) or `eslint.config.js` (ESM)
- Maintains auto-discovery and seamless linting experience
- Users can still get TypeScript intellisense using `import type { Config } from 'eslint'` or `typescript-eslint.config()` wrapper

### Future Consideration

After upgrading to ESLint v9+, TypeScript templates could use `eslint.config.ts`:

- Better developer experience with native TypeScript support
- Type checking and intellisense for ESLint configuration
- Maintains auto-discovery functionality

## Files Modified

- `packages/eslint-config/{index,shared}.{js,mjs}`
- `packages/create-cedar-app/templates/*/eslint.config.{js,mjs}`
- Template `package.json` files (removed `eslintConfig`)
- Root `.eslintrc.js` → `eslint.config.mjs`
