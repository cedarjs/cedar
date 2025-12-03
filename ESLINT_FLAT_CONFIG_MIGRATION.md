# ESLint Flat Config Migration

This document tracks the migration from legacy ESLint config format to the new flat config format for both the CedarJS framework and apps created with CedarJS.

## Background

ESLint's new flat config format (introduced in ESLint 8.21+) provides:
- Support for async configuration (needed for `getConfig()` - see `MIGRATION_PROGRESS_ASYNC_CONFIG.md`)
- Better performance
- Type-safe configuration
- More flexible config composition
- Simplified plugin/parser imports

## Current State

### Framework (CedarJS)
- ✅ `packages/create-cedar-rsc-app/eslint.config.js` - already using flat config
- ❌ Root `.eslintrc.js` - legacy format
- ❌ `docs/.eslintrc.js` - legacy format
- ❌ `tasks/test-project/.eslintrc.js` - legacy format

### Packages
- ❌ `packages/eslint-config/index.js` - exports legacy format
- ❌ `packages/eslint-config/shared.js` - exports legacy format

### Templates (for generated apps)
- ❌ `packages/create-cedar-app/templates/js/package.json` - uses `eslintConfig` in package.json
- ❌ `packages/create-cedar-app/templates/ts/package.json` - uses `eslintConfig` in package.json
- ❌ `packages/create-cedar-app/templates/esm-js/package.json` - uses `eslintConfig` in package.json
- ❌ `packages/create-cedar-app/templates/esm-ts/package.json` - uses `eslintConfig` in package.json

## Migration Tasks

### Phase 1: Core Package Migration
- [ ] Create `packages/eslint-config/index.mjs` with flat config export
- [ ] Create `packages/eslint-config/shared.mjs` with shared flat config
- [ ] Convert plugin imports from strings to actual imports
- [ ] Convert `env` and `globals` to `languageOptions`
- [ ] Convert `overrides` array to separate config objects
- [ ] Handle dynamic Babel config resolution for projects
- [ ] Update `packages/eslint-config/package.json` exports field
- [ ] Add backward compatibility note in README
- [ ] Test with a sample project

### Phase 2: Framework Migration
- [ ] Convert root `.eslintrc.js` to `eslint.config.js`
  - [ ] Import all plugins as modules
  - [ ] Convert TypeScript overrides to flat config
  - [ ] Convert file-specific overrides
  - [ ] Convert browser/node environment overrides
  - [ ] Handle `@babel/eslint-parser` configuration
  - [ ] Preserve all ignore patterns
- [ ] Update `package.json` lint scripts
  - [ ] Remove `--config .eslintrc.js` flag
  - [ ] Remove `--no-eslintrc` flag
  - [ ] Update `lint:fw` script
  - [ ] Update `lint:fw:fix` script
- [ ] Test framework linting still works
- [ ] Delete `.eslintrc.js` after verification

### Phase 3: Template Updates
- [ ] Create `packages/create-cedar-app/templates/js/eslint.config.js`
- [ ] Create `packages/create-cedar-app/templates/ts/eslint.config.js`
- [ ] Create `packages/create-cedar-app/templates/esm-js/eslint.config.js`
- [ ] Create `packages/create-cedar-app/templates/esm-ts/eslint.config.js`
- [ ] Remove `eslintConfig` from all template `package.json` files
- [ ] Test template generation
- [ ] Test linting in generated projects

### Phase 4: Documentation and Other Configs
- [ ] Convert `docs/.eslintrc.js` to `docs/eslint.config.js`
- [ ] Convert `tasks/test-project/.eslintrc.js` to `tasks/test-project/eslint.config.js`
- [ ] Update any documentation mentioning `.eslintrc.js`
- [ ] Update CONTRIBUTING.md if needed
- [ ] Update any ESLint-related documentation

### Phase 5: Fixture Updates
- [ ] Update all fixture projects in `__fixtures__/*/package.json`
  - [ ] `__fixtures__/empty-project/package.json`
  - [ ] `__fixtures__/esm-test-project/package.json`
  - [ ] `__fixtures__/example-todo-main/package.json`
  - [ ] `__fixtures__/example-todo-main-with-errors/package.json`
  - [ ] `__fixtures__/rsc-caching/package.json`
  - [ ] `__fixtures__/test-project/package.json`
  - [ ] `__fixtures__/test-project-rsa/package.json`
  - [ ] `__fixtures__/test-project-rsc-kitchen-sink/package.json`
- [ ] Create corresponding `eslint.config.js` files for fixtures
- [ ] Test fixtures still work correctly

### Phase 6: Final Cleanup
- [ ] Remove any remaining `.eslintrc.js` files
- [ ] Update `.gitignore` if needed
- [ ] Run full test suite
- [ ] Run full lint suite
- [ ] Update changelog
- [ ] Consider deprecation notice for old format support (if maintaining backward compat)

## Key Migration Patterns

### Plugin Import Pattern
```javascript
// Old
plugins: ['react', 'jsx-a11y']

// New
import react from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  {
    plugins: {
      react,
      'jsx-a11y': jsxA11y,
    }
  }
]
```

### Environment/Globals Pattern
```javascript
// Old
env: {
  browser: true,
  node: true,
  es2022: true,
}

// New
import globals from 'globals'

export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      ecmaVersion: 2022,
    }
  }
]
```

### Override Pattern
```javascript
// Old
overrides: [
  {
    files: ['*.ts', '*.tsx'],
    parser: '@typescript-eslint/parser',
    rules: { /* ... */ }
  }
]

// New
export default [
  {
    files: ['*.ts', '*.tsx'],
    languageOptions: {
      parser: tsParser,
    },
    rules: { /* ... */ }
  }
]
```

## Notes

- The `create-cedar-rsc-app` package already uses flat config and can serve as a reference
- Flat config files use `.js` or `.mjs` extension (not `.json` or `.yaml`)
- Cannot use `eslintConfig` field in `package.json` with flat config
- Must use actual file: `eslint.config.js`
- Flat config is the default in ESLint 9+, but we're currently on ESLint 8.57.1

## References

- [ESLint Flat Config Documentation](https://eslint.org/docs/latest/use/configure/configuration-files)
- [ESLint Migration Guide](https://eslint.org/docs/latest/use/configure/migration-guide)
- Async Config Issue: See `MIGRATION_PROGRESS_ASYNC_CONFIG.md`
