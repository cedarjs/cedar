# Test Fixtures

This directory contains test project fixtures used across the Cedar framework for testing and CI/CD.

## Active Fixtures

### Core Test Infrastructure

**test-project** (948K)
- **Purpose**: Main test fixture used throughout the codebase
- **⚠️ DO NOT REMOVE**: This is the primary test project
- **Usage**: Hundreds of references across all packages

**example-todo-main** (476K)
- **Purpose**: Integration testing across packages
- **Usage**: 56+ references
- **Used by**: @cedarjs/structure, @cedarjs/internal, @cedarjs/project-config, @cedarjs/babel-config

**example-todo-main-with-errors** (296K)
- **Purpose**: Error handling and validation testing
- **Usage**: 16 references
- **Used by**: @cedarjs/structure, @cedarjs/internal, @cedarjs/project-config
- **Unique Features**:
  - SDL files with various auth directive errors (missing directives, invalid roles, etc.)
  - Duplicate routes in Routes.js for testing route conflict detection
  - Cell with unnamed GraphQL QUERY for testing validation warnings
  - No vite config (tests path detection when vite is not configured)
  - JavaScript-based instead of TypeScript
- **⚠️ Cannot be replaced**: These specific error conditions are not present in `example-todo-main`

### CI/CD Dependencies

**test-project-rsa** (360K)
- **Purpose**: React Server Actions (RSA) smoke tests
- **CI Workflow**: `.github/workflows/rsc-smoke-tests.yml`
- **GitHub Action**: `.github/actions/set-up-rsa-project`

**esm-test-project** (964K)
- **Purpose**: ESM module format testing
- **CI Workflow**: `.github/workflows/smoke-tests-test-esm.yml`
- **GitHub Action**: `.github/actions/set-up-test-project-esm`
- **Rebuild Script**: `tasks/test-project/rebuild-test-project-fixture-esm.ts`

**test-project-rsc-kitchen-sink** (936K)
- **Purpose**: Comprehensive RSC feature testing
- **CI Workflow**: `.github/workflows/rsc-smoke-tests.yml`
- **GitHub Action**: `.github/actions/set-up-rsc-kitchen-sink-project`
- **Default Template**: Used in `packages/create-cedar-rsc-app/src/config.ts`

### Specialized Testing

**empty-project** (240K)
- **Purpose**: Minimal project for basic path/config tests
- **Usage**: 8 references
- **Used by**: @cedarjs/structure, @cedarjs/testing, @cedarjs/internal, @cedarjs/project-config, @cedarjs/babel-config

## Recently Removed

The following fixtures were removed as they had zero references:

- **esm-fragment-test-project** (1.1M) - Removed in PR #551 and this PR
- **fragment-test-project** (1.1M) - Removed in PR #551
- **rsc-caching** (376K) - Removed in this PR

## Before Removing a Fixture

Check the following before removing any fixture:

1. **Code References**: Search all TypeScript, JavaScript, JSON files
   ```bash
   grep -r "fixture-name" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json"
   ```

2. **GitHub Actions**: Check `.github/actions/` and `.github/workflows/`
   ```bash
   grep -r "fixture-name" .github/
   ```

3. **Rebuild Scripts**: Check `tasks/test-project/`
   ```bash
   ls tasks/test-project/ | grep fixture-name
   ```

4. **Documentation**: Check all Markdown files
   ```bash
   grep -r "fixture-name" --include="*.md"
   ```

## Total Size

Current fixtures: ~4.2MB total across 7 projects

## Maintenance

- Fixtures should only be removed if they have **zero references** across code, tests, CI/CD, and documentation
- Most fixtures serve distinct purposes and are actively maintained
- CI/CD fixtures are critical and should not be removed without updating workflows
