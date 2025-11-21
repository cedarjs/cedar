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

**fragment-test-project** (1.1M)
- **Purpose**: GraphQL fragment testing
- **Usage**: 6 references
- **Rebuild Script**: `tasks/test-project/rebuild-fragments-test-project-fixture.ts`
- **Used by**: @cedarjs/internal (possibleTypes tests)

**empty-project** (240K)
- **Purpose**: Minimal project for basic path/config tests
- **Usage**: 8 references
- **Used by**: @cedarjs/structure, @cedarjs/testing, @cedarjs/internal, @cedarjs/project-config, @cedarjs/babel-config

## Recently Removed

The following fixtures were removed as they had zero references:

- **esm-fragment-test-project** (1.1M) - Removed in PR #XXX
- **rsc-caching** (376K) - Removed in PR #XXX

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

Current fixtures: ~5.2MB total across 8 projects

## Maintenance

- Fixtures should only be removed if they have **zero references** across code, tests, CI/CD, and documentation
- Most fixtures serve distinct purposes and are actively maintained
- CI/CD fixtures are critical and should not be removed without updating workflows
