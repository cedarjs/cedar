# Testing Plan Summary: Package Watching in Dev Mode

## Overview

This document provides a high-level summary of the automated testing plan for the package watching functionality in `yarn cedar dev`.

## Test Coverage Plan

### Unit Tests (Phase 1)
**File:** `cedar/packages/cli/src/commands/dev/__tests__/watchPackagesTask.test.js`

Tests the `watchPackagesTask` function in isolation:
- ✅ Expands `packages/*` wildcard to all packages
- ✅ Watches specific named packages
- ✅ Filters out packages without watch scripts (with warnings)
- ✅ Returns null when no watchable packages exist
- ✅ Handles empty packages directory
- ✅ Handles package.json read errors
- ✅ Throws error for non-existent workspaces
- ✅ Handles concurrently errors with telemetry

### Integration Tests (Phase 2)
**File:** `cedar/packages/cli/src/commands/__tests__/dev.test.ts` (existing file, add tests)

Tests how the dev command integrates with package watching:
- ✅ Runs package watchers by default when packages exist
- ✅ Does not run watchers when no packages exist
- ✅ Handles explicit workspace selection
- ✅ Runs specific package watchers when requested
- ✅ Handles initial build failures gracefully
- ✅ Skips packages when workspaces array has only 2 entries
- ✅ Includes packages job in concurrently with correct config
- ✅ Uses yellow prefix color for package output

### Validation Tests (Phase 3)
**File:** `cedar/packages/cli/src/commands/__tests__/devValidation.test.ts`

Tests command-line argument validation:
- ✅ Accepts valid workspace names
- ✅ Rejects unknown workspace names with error message
- ✅ Optimizes by skipping workspace check for standard sides only
- ✅ Calls workspaces() when non-standard sides present
- ✅ Handles `packages/*` wildcard correctly

### Test Utilities (Phase 4)
**File:** `cedar/packages/cli/src/commands/dev/__tests__/devTestUtils.ts`

Reusable test helpers:
- `createMockPackageJson(name, hasWatchScript)` - Creates mock package.json
- `createMockPaths(options)` - Returns mock paths structure
- `createMockWorkspaces(packages)` - Returns mock workspace config
- `findPackagesCommand()` - Extracts packages command from concurrently
- `mockPackagesDirectory(packageNames)` - Sets up complete mock structure

### Edge Cases (Phase 5)
Additional tests for unusual scenarios:
- ✅ Windows path separators
- ✅ Scoped package names (`@org/package`)
- ✅ Special characters in package names
- ✅ Very long package names
- ✅ Many packages (10+) concurrently
- ✅ Empty package.json

### Error Scenarios (Phase 6)
Tests for error handling:
- ✅ Filesystem permission errors
- ✅ Corrupted package.json
- ✅ Missing packages directory
- ✅ Concurrently process crashes

## Test Strategy

### Mocking Approach
- **node:fs** - Mock file system operations
- **concurrently** - Mock process spawning
- **@cedarjs/telemetry** - Mock telemetry calls
- **getPaths** - Mock project paths
- **buildPackagesTask** - Mock initial build

### Following Existing Patterns
Tests follow established patterns from:
- `buildPackagesTask.test.js` - Similar structure for package operations
- `dev.test.ts` - Existing dev command test patterns

### Test Framework
- **Vitest** - Test runner (already in use)
- **memfs** - Filesystem mocking where needed
- **vi.mock()** - Module mocking

## Coverage Goals

| Metric | Target |
|--------|--------|
| Line Coverage | > 90% |
| Branch Coverage | > 85% |
| Function Coverage | > 95% |

## Critical Paths Covered

1. ✅ Package detection and filtering
2. ✅ Watch command execution
3. ✅ Initial build process
4. ✅ Error handling and telemetry
5. ✅ Validation logic
6. ✅ Integration with existing dev jobs

## Implementation Phases

```
Phase 1: watchPackagesTask unit tests
   ↓
Phase 2: Dev command integration tests
   ↓
Phase 3: Validation tests
   ↓
Phase 4: Test utilities (refactor)
   ↓
Phase 5: Edge cases
   ↓
Phase 6: Error scenarios
```

## Files to Create/Modify

### New Files
- `cedar/packages/cli/src/commands/dev/__tests__/watchPackagesTask.test.js`
- `cedar/packages/cli/src/commands/dev/__tests__/devTestUtils.ts`
- `cedar/packages/cli/src/commands/dev/__tests__/devValidation.test.ts`

### Modified Files
- `cedar/packages/cli/src/commands/__tests__/dev.test.ts` (add new tests)

## Running Tests

```bash
# Run all tests
yarn test

# Run specific test file
yarn test watchPackagesTask.test.js

# Run with coverage
yarn test --coverage

# Watch mode during development
yarn test --watch
```

## Success Criteria

- [ ] All phases implemented
- [ ] All tests passing
- [ ] Coverage targets met (>90% lines)
- [ ] Tests run in < 5 seconds
- [ ] No flaky tests
- [ ] Follows project conventions

## Future Enhancements (Out of Scope)

### E2E Tests
- Real file watching with actual tsc processes
- Verify hot-reloading in browser/API
- Test full developer workflow

### Performance Tests
- Startup time benchmarks
- Memory usage monitoring
- Watch responsiveness metrics

### Visual Tests
- Colored output rendering
- Console formatting
- Multiple watcher output interleaving

## Key Testing Principles

1. **Arrange-Act-Assert** - Clear test structure
2. **One Thing Per Test** - Single responsibility
3. **Descriptive Names** - Tests as documentation
4. **Fast Tests** - Mock external processes
5. **Reliable Tests** - No intermittent failures
6. **Clean Mocks** - Reset after each test

## Next Steps

1. Start with Phase 1 (watchPackagesTask unit tests)
2. Ensure all tests pass before moving to next phase
3. Monitor coverage as you go
4. Refactor common patterns into utilities (Phase 4)
5. Add edge cases and error scenarios last

---

**Status:** Ready for implementation ✅

See `DEV_PACKAGES_WATCH_TESTING_PLAN.md` for detailed task checklist.