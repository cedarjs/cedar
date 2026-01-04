# Quick Reference: Testing Package Watching Feature

## 🎯 Quick Start

```bash
# Run tests
yarn test watchPackagesTask.test.js

# Run with coverage
yarn test --coverage watchPackagesTask.test.js

# Watch mode
yarn test --watch
```

## 📋 Implementation Checklist

### Phase 1: watchPackagesTask Unit Tests ⭐ START HERE
```bash
# Create test file
touch cedar/packages/cli/src/commands/dev/__tests__/watchPackagesTask.test.js
```

**Priority Tests to Write:**
1. ✅ Expands `packages/*` to all packages
2. ✅ Watches specific package workspaces
3. ✅ Filters packages without watch script
4. ✅ Returns null when no watchable packages
5. ✅ Handles concurrently errors

### Phase 2: Integration Tests
**File:** `cedar/packages/cli/src/commands/__tests__/dev.test.ts`
- Add tests for package watching in existing dev.test.ts
- Follow patterns from existing tests

### Phase 3: Validation Tests
**File:** `cedar/packages/cli/src/commands/__tests__/devValidation.test.ts`
- Test command-line argument validation
- Test workspace name checking

## 🔧 Standard Mock Setup

```javascript
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn((path) => {
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          name: 'test-package',
          scripts: { watch: 'tsc --watch' }
        })
      }
    }),
    promises: {
      glob: vi.fn(() => [
        '/mocked/project/packages/foo',
        '/mocked/project/packages/bar',
      ]),
    },
  },
}))

vi.mock('concurrently', () => ({
  default: vi.fn(() => ({ result: Promise.resolve() })),
}))

vi.mock('../../lib/index.js', () => ({
  getPaths: vi.fn(() => ({
    base: '/mocked/project',
    packages: '/mocked/project/packages',
  })),
}))

vi.mock('@cedarjs/telemetry', () => ({
  errorTelemetry: vi.fn(),
}))

vi.mock('../../lib/exit.js', () => ({
  exitWithError: vi.fn(),
}))

vi.mock('../../lib/colors.js', () => ({
  default: {
    warning: (str) => str,
    error: (str) => str,
  },
}))
```

## 📝 Test Template

```javascript
import { vi, describe, it, expect, afterEach } from 'vitest'
import { watchPackagesTask } from '../watchPackagesTask.js'

// ... mocks here ...

afterEach(() => {
  vi.clearAllMocks()
})

describe('watchPackagesTask', () => {
  it('expands packages/* to all packages', async () => {
    // Arrange
    vi.mocked(fs).promises.glob.mockResolvedValue([
      '/mocked/project/packages/foo',
      '/mocked/project/packages/bar',
    ])
    
    // Act
    await watchPackagesTask(['packages/*'])
    
    // Assert
    expect(concurrently).toHaveBeenCalledWith(
      [
        {
          command: 'yarn watch',
          name: 'foo',
          cwd: '/mocked/project/packages/foo',
        },
        {
          command: 'yarn watch',
          name: 'bar',
          cwd: '/mocked/project/packages/bar',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      }
    )
  })
})
```

## 🎨 Common Test Patterns

### Testing Package Filtering
```javascript
it('filters out packages without watch script', async () => {
  vi.mocked(fs).readFileSync.mockImplementation((path) => {
    if (path.includes('foo')) {
      return JSON.stringify({
        name: 'foo',
        scripts: { watch: 'tsc --watch' }
      })
    }
    if (path.includes('bar')) {
      return JSON.stringify({
        name: 'bar',
        scripts: { build: 'tsc' } // No watch!
      })
    }
  })
  
  await watchPackagesTask(['packages/*'])
  
  // Should only watch 'foo', not 'bar'
  expect(concurrently).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ name: 'foo' })
    ])
  )
  
  // Should warn about 'bar'
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining('bar')
  )
})
```

### Testing Error Handling
```javascript
it('handles concurrently errors', async () => {
  vi.mocked(concurrently).mockReturnValue({
    result: Promise.reject(new Error('Process failed'))
  })
  
  await watchPackagesTask(['packages/*'])
  
  expect(errorTelemetry).toHaveBeenCalledWith(
    process.argv,
    expect.stringContaining('Error watching packages')
  )
  expect(exitWithError).toHaveBeenCalled()
})
```

### Testing Null Return
```javascript
it('returns null when no watchable packages exist', async () => {
  vi.mocked(fs).promises.glob.mockResolvedValue([])
  
  const result = await watchPackagesTask(['packages/*'])
  
  expect(result).toBeNull()
  expect(concurrently).not.toHaveBeenCalled()
})
```

## 🔍 Debugging Tests

### Check Mock Calls
```javascript
console.log(vi.mocked(concurrently).mock.calls)
console.log(vi.mocked(concurrently).mock.calls[0][0]) // First arg of first call
```

### Log Mock Return Values
```javascript
console.log(vi.mocked(fs).promises.glob.mock.results)
```

### Test Specific Test
```bash
yarn test watchPackagesTask.test.js -t "expands packages"
```

## ✅ Verification Checklist

Before marking tests complete:
- [ ] All tests pass
- [ ] Coverage > 90% for watchPackagesTask.js
- [ ] Mocks are cleaned up (afterEach)
- [ ] Test names are descriptive
- [ ] Edge cases covered
- [ ] Error scenarios tested
- [ ] No console warnings during test runs

## 📊 Coverage Commands

```bash
# Run with coverage
yarn test --coverage

# Coverage for specific file
yarn test --coverage watchPackagesTask.test.js

# View HTML coverage report
open coverage/index.html
```

## 🐛 Common Issues

### Issue: "Cannot find module"
**Fix:** Check import paths - use relative paths with `.js` extension

### Issue: "Mock not working"
**Fix:** Ensure `vi.mock()` is called before imports

### Issue: "Test timeout"
**Fix:** Add `await` before async functions

### Issue: "Unexpected call to mock"
**Fix:** Use `vi.clearAllMocks()` in `afterEach()`

## 📚 Reference Examples

Look at these files for patterns:
- `cedar/packages/cli/src/commands/build/__tests__/buildPackagesTask.test.js`
- `cedar/packages/cli/src/commands/__tests__/dev.test.ts`
- `cedar/packages/cli/src/commands/generate/package/__tests__/package.test.ts`

## 🚀 Quick Wins

Start with these high-value tests:
1. Basic functionality (`packages/*` expansion) 
2. Package filtering (with/without watch script)
3. Error handling (telemetry + exitWithError)
4. Integration test (packages job in dev command)

Then add edge cases and validation tests.

---

**Ready to start?** Begin with Phase 1, watchPackagesTask.test.js! 🎯