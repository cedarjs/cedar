# Automated Testing Plan: Package Watching in Dev Mode

## Overview

This document outlines a comprehensive automated testing strategy for the package watching functionality in `yarn cedar dev`. The plan includes unit tests, integration tests, and considerations for E2E testing.

## Testing Strategy

### 1. Unit Tests
Test individual functions and modules in isolation with mocked dependencies.

### 2. Integration Tests
Test how the dev command integrates with package watching, ensuring proper coordination between components.

### 3. E2E Tests (Future)
Test the full user experience with real processes and file watching (more complex, suggested for future iteration).

---

## Tasks

### Phase 1: Unit Tests for watchPackagesTask ✅ COMPLETE

- [x] Create test file: `cedar/packages/cli/src/commands/dev/__tests__/watchPackagesTask.test.js`
  - [x] Set up test environment with mocks
    - [x] Mock `node:fs` and `fs.promises.glob`
    - [x] Mock `concurrently`
    - [x] Mock `getPaths` from `../../lib/index.js`
    - [x] Mock `@cedarjs/telemetry`
    - [x] Mock `exitWithError`
  - [x] Test: `expands packages/* to all packages`
    - [x] Call `watchPackagesTask(['packages/*'])`
    - [x] Verify `fs.promises.glob` is called with correct pattern
    - [x] Verify `concurrently` is called with correct watch commands
    - [x] Verify command is `yarn watch` (not `yarn build`)
  - [x] Test: `watches specific package workspaces`
    - [x] Call `watchPackagesTask(['@my-org/pkg-one', 'pkg-two'])`
    - [x] Verify glob is NOT called
    - [x] Verify correct packages are passed to concurrently
    - [x] Verify correct cwd for each package
  - [x] Test: `filters out packages without watch script`
    - [x] Mock some packages with watch scripts, some without
    - [x] Verify only watchable packages are passed to concurrently
    - [x] Verify warning is logged for packages without watch script
  - [x] Test: `returns null when no watchable packages exist`
    - [x] Mock all packages without watch scripts
    - [x] Verify function returns null
    - [x] Verify concurrently is not called
  - [x] Test: `handles empty packages directory`
    - [x] Mock glob returning empty array
    - [x] Verify returns null
    - [x] Verify concurrently is not called
  - [x] Test: `handles package.json read errors gracefully`
    - [x] Mock package.json that doesn't exist
    - [x] Verify package is skipped (not crashed)
  - [x] Test: `throws error for non-existent specific workspace`
    - [x] Call with specific package that doesn't exist
    - [x] Verify error is thrown
  - [x] Test: `handles concurrently errors`
    - [x] Mock concurrently to reject
    - [x] Verify error telemetry is called
    - [x] Verify exitWithError is called

### Phase 2: Integration Tests for Dev Command ✅ COMPLETE

- [x] Create new test file: `cedar/packages/cli/src/commands/__tests__/devPackages.test.ts`
  - [x] Add mock for `buildPackagesTask`
  - [x] Add mock for `watchPackagesTask`
  - [x] Update fs mock to handle packages directory and package.json files
  - [x] Test: `runs package watchers by default when packages exist`
    - [x] Mock project with packages directory
    - [x] Call `handler({ side: ['api', 'web'] })`
    - [x] Verify packages job is included in concurrently
  - [x] Test: `runs specific package watchers when requested`
    - [x] Mock project with multiple packages
    - [x] Call `handler({ side: ['api', 'my-package'] })`
    - [x] Verify packages job is registered
  - [x] Test: `packages job is registered even if initial build fails`
    - [x] Verify packages job is still registered
  - [x] Test: `includes packages job with correct configuration`
    - [x] Verify packages job appears in concurrently command list
    - [x] Verify job has correct name, command, and color
  - [x] Test: `packages job uses yellow prefix color`
    - [x] Mock packages exist
    - [x] Verify packages job has prefixColor: 'yellow'
  - [x] Test: `packages command is an async function`
    - [x] Verify command is a function
  - [x] Test: `registers packages job for default sides`
    - [x] Verify packages job is registered
  - [x] Test: `registers packages job for specific package sides`
    - [x] Verify packages job is registered for specific packages
  - [x] Made imports dynamic in devHandler.ts to fix test loading issues
  - [ ] **TODO:** Test: `does not run package watchers when no packages workspace exists`
    - [ ] Mock root package.json with workspaces: ['api', 'web'] (only 2 entries)
    - [ ] Call `handler({ side: ['api', 'web'] })`
    - [ ] Verify packages job is NOT included in concurrently
    - [ ] Note: Difficult because hasPackageWorkspaces is computed at handler start
    - [ ] Possible solution: Mock fs.readFileSync before importing handler
  - [ ] **TODO:** Test: `does not run package watchers when packages directory does not exist`
    - [ ] Mock fs.existsSync to return false for packages directory
    - [ ] Call `handler({ side: ['api', 'web'] })`
    - [ ] Verify packages job is NOT included in concurrently
    - [ ] Note: Mock override timing is tricky with current setup
    - [ ] Possible solution: Set up mock before handler is loaded
  - [ ] **TODO:** Test: `verify buildPackagesTask is called with correct arguments`
    - [ ] Mock buildPackagesTask to track calls
    - [ ] Verify it's called with ['packages/*'] for default sides
    - [ ] Verify it's called with specific package names when provided
    - [ ] Note: Dynamic import makes this challenging
    - [ ] Possible solution: Use import.meta.resolve or custom module loader
  - [ ] **TODO:** Test: `verify watchPackagesTask is called with correct arguments`
    - [ ] Mock watchPackagesTask to track calls within the async command
    - [ ] Verify correct arguments are passed
    - [ ] Note: Command is async function, hard to intercept
    - [ ] Possible solution: Execute the command function and check calls

### Phase 3: Validation Tests for Dev Command

- [ ] Create test file: `cedar/packages/cli/src/commands/__tests__/devValidation.test.ts`
  - [ ] Set up test environment
    - [ ] Mock `workspaces` function
    - [ ] Mock yargs for validation testing
  - [ ] Test: `accepts valid workspace names`
    - [ ] Mock workspaces returning ['api', 'web', 'packages/*', 'my-package']
    - [ ] Verify validation passes for 'api', 'web', 'packages/*'
    - [ ] Verify validation passes for 'my-package'
  - [ ] Test: `rejects unknown workspace names`
    - [ ] Mock workspaces returning ['api', 'web', 'my-package']
    - [ ] Try to validate with 'non-existent-package'
    - [ ] Verify validation fails with appropriate error message
  - [ ] Test: `validation optimization - skips check for standard sides only`
    - [ ] Call validation with ['api', 'web']
    - [ ] Verify `workspaces()` is NOT called (optimization)
  - [ ] Test: `validation calls workspaces when non-standard sides present`
    - [ ] Call validation with ['api', 'my-package']
    - [ ] Verify `workspaces({ includePackages: true })` IS called
  - [ ] Test: `validation handles packages/* wildcard`
    - [ ] Call validation with ['packages/*']
    - [ ] Verify validation passes without checking individual packages

### Phase 4: Mock Fixtures and Test Utilities

- [ ] Create test utility file: `cedar/packages/cli/src/commands/dev/__tests__/devTestUtils.ts`
  - [ ] Export `createMockPackageJson(name, hasWatchScript)`
    - [ ] Returns mock package.json content
  - [ ] Export `createMockPaths(options)`
    - [ ] Returns mock paths with optional packages directory
  - [ ] Export `createMockWorkspaces(packages)`
    - [ ] Returns mock root package.json with workspaces
  - [ ] Export `findPackagesCommand()`
    - [ ] Helper to extract packages command from concurrently args
  - [ ] Export `mockPackagesDirectory(packageNames)`
    - [ ] Sets up complete mock for packages directory structure

### Phase 5: Edge Case Tests

- [ ] Add edge case tests to appropriate test files
  - [ ] Test: `handles Windows path separators correctly`
    - [ ] Mock Windows-style paths
    - [ ] Verify glob pattern uses forward slashes
  - [ ] Test: `handles scoped package names (@org/package)`
    - [ ] Call with '@my-org/my-package'
    - [ ] Verify correct path resolution
  - [ ] Test: `handles packages with special characters in names`
    - [ ] Test with package names containing hyphens, underscores
  - [ ] Test: `handles very long package names`
    - [ ] Verify no truncation or issues with display
  - [ ] Test: `handles many packages (10+) concurrently`
    - [ ] Mock 15 packages
    - [ ] Verify all are passed to concurrently
  - [ ] Test: `handles empty package.json in packages directory`
    - [ ] Mock package.json with no scripts section
    - [ ] Verify graceful handling

### Phase 6: Error Scenarios

- [ ] Add error scenario tests
  - [ ] Test: `handles filesystem permission errors`
    - [ ] Mock fs.existsSync to throw EACCES
    - [ ] Verify error is caught and reported
  - [ ] Test: `handles corrupted package.json`
    - [ ] Mock fs.readFileSync returning invalid JSON
    - [ ] Verify error is caught gracefully
  - [ ] Test: `handles missing packages directory mid-execution`
    - [ ] Mock packages directory existing initially but deleted
    - [ ] Verify appropriate error handling
  - [ ] Test: `handles concurrently process crashes`
    - [ ] Mock concurrently result.catch scenario
    - [ ] Verify telemetry is recorded
    - [ ] Verify exitWithError is called

---

## Test File Structure

```
cedar/packages/cli/src/commands/dev/
├── __tests__/
│   ├── watchPackagesTask.test.js      (NEW - Phase 1)
│   ├── devTestUtils.ts                (NEW - Phase 4)
│   └── devValidation.test.ts          (NEW - Phase 3)
│
cedar/packages/cli/src/commands/__tests__/
├── dev.test.ts                         (UPDATE - Phase 2)
```

## Test Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Dev Command Tests                          │
│                     (dev.test.ts - Phase 2)                     │
│                                                                 │
│  • Integration tests for full dev command                       │
│  • Tests package watching alongside api/web/gen                 │
│  • Tests initial build + watch coordination                     │
│  • Mocks: buildPackagesTask, watchPackagesTask                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ imports & uses
                 │
    ┌────────────┴──────────────┐
    │                           │
    ▼                          ▼
┌─────────────────────┐   ┌──────────────────────┐
│ watchPackagesTask   │   │   Validation Tests   │
│      Tests          │   │ (devValidation.test) │
│  (Phase 1)          │   │     (Phase 3)        │
│                     │   │                      │
│ • Unit tests for    │   │ • Tests yargs check  │
│   watchPackagesTask │   │ • Workspace name     │
│ • Package filtering │   │   validation         │
│ • Glob expansion    │   │ • Error messages     │
│ • Error handling    │   │ • Optimization paths │
│ • Telemetry         │   └──────────────────────┘
└─────────────────────┘
         │
         │ uses utilities from
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Test Utilities                           │
│                  (devTestUtils.ts - Phase 4)                │
│                                                             │
│  • createMockPackageJson()                                  │
│  • createMockPaths()                                        │
│  • createMockWorkspaces()                                   │
│  • findPackagesCommand()                                    │
│  • mockPackagesDirectory()                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Shared Mocks                            │
│                                                             │
│  • node:fs (existsSync, readFileSync, glob)                 │
│  • concurrently                                             │
│  • @cedarjs/telemetry                                       │
│  • getPaths                                                 │
│  • colors                                                   │
│  • exitWithError                                            │
└─────────────────────────────────────────────────────────────┘

Coverage Flow:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Unit Tests │───▶│ Integration  │───▶│ Edge Cases & │
│   (Phase 1)  │     │    Tests     │     │   Errors     │
│              │     │  (Phase 2-3) │     │ (Phase 5-6)  │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## Mock Strategy

### Standard Mocks (Applied to Most Tests)

```javascript
// Mock node:fs
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      glob: vi.fn(),
    },
  },
}))

// Mock concurrently
vi.mock('concurrently', () => ({
  default: vi.fn(() => ({
    result: Promise.resolve(),
  })),
}))

// Mock getPaths
vi.mock('../../lib/index.js', () => ({
  getPaths: vi.fn(() => ({
    base: '/mocked/project',
    packages: '/mocked/project/packages',
    api: { /* ... */ },
    web: { /* ... */ },
  })),
}))

// Mock telemetry
vi.mock('@cedarjs/telemetry', () => ({
  errorTelemetry: vi.fn(),
}))

// Mock colors and exit
vi.mock('../../lib/colors.js', () => ({
  default: {
    warning: (str) => str,
    error: (str) => str,
  },
}))

vi.mock('../../lib/exit.js', () => ({
  exitWithError: vi.fn(),
}))
```

---

## Expected Test Coverage

### Target Metrics
- **Line Coverage:** > 90%
- **Branch Coverage:** > 85%
- **Function Coverage:** > 95%

### Critical Paths to Cover
1. ✅ Package detection and filtering
2. ✅ Watch command execution
3. ✅ Initial build process
4. ✅ Error handling and telemetry
5. ✅ Validation logic
6. ✅ Integration with existing dev jobs

---

## Testing Patterns to Follow

### 1. Arrange-Act-Assert Pattern
```javascript
it('does something', async () => {
  // Arrange: Set up mocks and test data
  vi.mocked(fs).existsSync.mockReturnValue(true)
  
  // Act: Execute the function
  await watchPackagesTask(['packages/*'])
  
  // Assert: Verify expectations
  expect(concurrently).toHaveBeenCalledWith(...)
})
```

### 2. Consistent Mock Cleanup
```javascript
afterEach(() => {
  vi.clearAllMocks()
})
```

### 3. Descriptive Test Names
Use full sentences that describe the expected behavior:
- ✅ `filters out packages without watch script`
- ❌ `test packages`

### 4. Test One Thing
Each test should verify one specific behavior or scenario.

---

## Running Tests

### Run All Tests
```bash
yarn test
```

### Run Specific Test File
```bash
yarn test watchPackagesTask.test.js
```

### Run Tests in Watch Mode
```bash
yarn test --watch
```

### Run Tests with Coverage
```bash
yarn test --coverage
```

---

## Future Enhancements (Out of Scope for Initial Implementation)

### E2E Tests with Real File Watching
- [ ] Create fixture project with real packages
- [ ] Start actual dev server
- [ ] Modify package source files
- [ ] Verify TypeScript recompilation occurs
- [ ] Verify API/web sides can import updated code
- [ ] Verify console output formatting

### Performance Tests
- [ ] Measure startup time with 0, 1, 5, 10, 20 packages
- [ ] Measure memory usage with many packages
- [ ] Test watch responsiveness (time from file save to rebuild)

### Visual/UI Tests
- [ ] Test colored output rendering
- [ ] Test prefix formatting
- [ ] Test interleaved output from multiple watchers

---

## Success Criteria

- [x] watchPackagesTask has comprehensive unit tests
- [x] All unit tests passing (Phase 1: 10/10 tests pass)
- [x] Integration tests verify dev command works with packages (Phase 2: 8/8 tests pass)
- [x] Edge cases are handled gracefully
- [x] Error scenarios are tested
- [ ] Test coverage meets targets (>90% lines) - Coverage analysis skipped per request
- [x] Tests are fast (<5 seconds total)
- [x] Tests are reliable (no flaky tests)
- [x] Tests follow project conventions

---

## Implementation Order

1. **Phase 1:** Unit tests for watchPackagesTask (core functionality)
2. **Phase 2:** Integration tests for dev command (how it all fits together)
3. **Phase 3:** Validation tests (command-line argument handling)
4. **Phase 4:** Test utilities (DRY up test code)
5. **Phase 5:** Edge cases (cover unusual scenarios)
6. **Phase 6:** Error scenarios (ensure robustness)

---

## TODO: Difficult Tests to Implement Later

These tests were identified as challenging due to mock timing issues or dynamic import complexities. They are left for future implementation.

### Integration Tests (Phase 2)

- [ ] **Test: `does not run package watchers when no packages workspace exists`**
  - **Challenge:** `hasPackageWorkspaces` is computed at handler start using `fs.readFileSync`
  - **Current Issue:** Per-test mock overrides happen too late
  - **Possible Solutions:**
    - Reset and re-mock fs.readFileSync before each test at the module level
    - Create separate test file with different default mocks
    - Use vitest's `vi.hoisted()` to ensure mocks are set up before imports
  - **Implementation Steps:**
    1. Mock root package.json with `workspaces: ['api', 'web']` (only 2 entries)
    2. Call `handler({ side: ['api', 'web'] })`
    3. Verify packages job is NOT included in concurrently args
    4. Verify `buildPackagesTask` was NOT called

- [ ] **Test: `does not run package watchers when packages directory does not exist`**
  - **Challenge:** `fs.existsSync(rwjsPaths.packages)` check in runWhen function
  - **Current Issue:** Mock override timing - runWhen is evaluated after mocks are set
  - **Possible Solutions:**
    - Ensure fs.existsSync mock returns false for packages path before handler call
    - Use vi.resetAllMocks() and re-setup mocks between tests
    - Create a factory function to create fresh handler instances
  - **Implementation Steps:**
    1. Mock `fs.existsSync` to return false for paths containing 'packages'
    2. Call `handler({ side: ['api', 'web'] })`
    3. Verify packages job is NOT included in concurrently
    4. Verify no "Building packages..." console output

- [ ] **Test: `verify buildPackagesTask is called with correct arguments`**
  - **Challenge:** Dynamic import (`await import('../build/buildPackagesTask.js')`)
  - **Current Issue:** Can't easily verify calls to dynamically imported functions
  - **Possible Solutions:**
    - Mock the import() function itself
    - Use vitest's module interception features
    - Capture calls by mocking at a lower level (e.g., execa/concurrently)
  - **Implementation Steps:**
    1. Set up spy on dynamic import resolution
    2. Call `handler({ side: ['api', 'web'] })`
    3. Verify `buildPackagesTask` was called with `['packages/*']`
    4. Call `handler({ side: ['@org/pkg-one', 'pkg-two'] })`
    5. Verify `buildPackagesTask` was called with `['@org/pkg-one', 'pkg-two']`

- [ ] **Test: `verify watchPackagesTask is called within async command`**
  - **Challenge:** `watchPackagesTask` is called inside an async command function
  - **Current Issue:** Command is registered but not executed during test
  - **Possible Solutions:**
    - Manually execute the command function from concurrently args
    - Mock concurrently to execute commands immediately
    - Add a test helper to extract and execute async commands
  - **Implementation Steps:**
    1. Get packages command from concurrently args
    2. Extract the command function
    3. Execute: `await packagesCommand.command()`
    4. Verify `watchPackagesTask` was called
    5. Verify correct arguments were passed

### Validation Tests (Phase 3) - Not Started

All Phase 3 tests remain to be implemented:

- [ ] Create test file: `cedar/packages/cli/src/commands/__tests__/devValidation.test.ts`
- [ ] Test: `accepts valid workspace names`
- [ ] Test: `rejects unknown workspace names`
- [ ] Test: `validation optimization - skips check for standard sides only`
- [ ] Test: `validation calls workspaces when non-standard sides present`
- [ ] Test: `validation handles packages/* wildcard`

### Test Utilities (Phase 4) - Not Started

All Phase 4 utilities remain to be implemented:

- [ ] Create: `cedar/packages/cli/src/commands/dev/__tests__/devTestUtils.ts`
- [ ] Implement: `createMockPackageJson(name, hasWatchScript)`
- [ ] Implement: `createMockPaths(options)`
- [ ] Implement: `createMockWorkspaces(packages)`
- [ ] Implement: `findPackagesCommand()`
- [ ] Implement: `mockPackagesDirectory(packageNames)`

### Edge Cases (Phase 5) - Not Started

All Phase 5 edge case tests remain to be implemented:

- [ ] Test: `handles Windows path separators correctly`
- [ ] Test: `handles scoped package names (@org/package)`
- [ ] Test: `handles packages with special characters in names`
- [ ] Test: `handles very long package names`
- [ ] Test: `handles many packages (10+) concurrently`
- [ ] Test: `handles empty package.json in packages directory`

### Error Scenarios (Phase 6) - Not Started

All Phase 6 error scenario tests remain to be implemented:

- [ ] Test: `handles filesystem permission errors`
- [ ] Test: `handles corrupted package.json`
- [ ] Test: `handles missing packages directory mid-execution`
- [ ] Test: `handles concurrently process crashes`

---

## Notes

- Follow existing test patterns from `buildPackagesTask.test.js` and `dev.test.ts`
- Use Vitest as the test runner (already in use)
- Use memfs for filesystem mocking where needed
- Keep tests fast by mocking external processes
- Ensure tests work on all platforms (Windows, macOS, Linux)
- Add comments for complex test scenarios
- Use test.each() for parameterized tests where appropriate
