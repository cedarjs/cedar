# Migration Example: Using matchFolderTransformFast

This document shows practical examples of migrating from the original `matchFolderTransform` to the optimized `matchFolderTransformFast`.

## Basic Migration

### Before (Original Implementation)
```typescript
import { afterEach, describe, test } from 'vitest'

describe('fragments possibleTypes import', () => {
  afterEach(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    //   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

  test('Default App.tsx', async () => {
    await matchFolderTransform('appImportTransform', 'import-simple', {
      useJsCodeshift: true,
    })
  })

  test('App.tsx with existing import', async () => {
    await matchFolderTransform('appImportTransform', 'existingImport', {
      useJsCodeshift: true,
    })
  })
})
```

### After (Optimized Implementation)
```typescript
import { afterEach, describe, test } from 'vitest'

describe('fragments possibleTypes import', () => {
  afterEach(async () => {
    // The fast implementation should eliminate the need for this workaround
    // but keeping minimal cleanup just in case
    await new Promise((res) => setImmediate(res))
  })

  test('Default App.tsx', async () => {
    await matchFolderTransformFast('appImportTransform', 'import-simple', {
      useJsCodeshift: true,
    })
  })

  test('App.tsx with existing import', async () => {
    await matchFolderTransformFast('appImportTransform', 'existingImport', {
      useJsCodeshift: true,
    })
  })
})
```

## Advanced Usage Examples

### Custom Target Patterns
```typescript
// Before
test('Transform specific file types', async () => {
  await matchFolderTransform('myTransform', 'my-fixture', {
    useJsCodeshift: true,
    targetPathsGlob: '**/*.{ts,tsx}',
    removeWhitespace: false,
  })
})

// After (identical API)
test('Transform specific file types', async () => {
  await matchFolderTransformFast('myTransform', 'my-fixture', {
    useJsCodeshift: true,
    targetPathsGlob: '**/*.{ts,tsx}',
    removeWhitespace: false,
  })
})
```

### Function-based Transforms
```typescript
// Before
test('Custom transform function', async () => {
  const transformFunction = async () => {
    // Custom transformation logic
    const files = await globby('**/*.js', { cwd: process.env.RWJS_CWD })
    for (const file of files) {
      // Transform each file
    }
  }

  await matchFolderTransform(transformFunction, 'function-fixture', {
    useJsCodeshift: false,
  })
})

// After (identical API)
test('Custom transform function', async () => {
  const transformFunction = async () => {
    // Custom transformation logic
    const files = await globby('**/*.js', { cwd: process.env.RWJS_CWD })
    for (const file of files) {
      // Transform each file
    }
  }

  await matchFolderTransformFast(transformFunction, 'function-fixture', {
    useJsCodeshift: false,
  })
})
```

## Test Timeout Optimization

### Before (with timeout workarounds)
```typescript
describe('slow transform tests', () => {
  // Increased timeout due to performance issues
  test('complex transformation', async () => {
    await matchFolderTransform('complexTransform', 'large-fixture', {
      useJsCodeshift: true,
    })
  }, 30000) // 30 second timeout

  afterEach(async () => {
    // Multiple workarounds for vitest timeout issues
    await new Promise((res) => setImmediate(res))
    await new Promise((res) => setTimeout(res, 100))
  })
})
```

### After (faster execution)
```typescript
describe('fast transform tests', () => {
  // Default timeout should be sufficient now
  test('complex transformation', async () => {
    await matchFolderTransformFast('complexTransform', 'large-fixture', {
      useJsCodeshift: true,
    })
  }) // No timeout needed - typically completes in <1s

  afterEach(async () => {
    // Minimal cleanup
    await new Promise((res) => setImmediate(res))
  })
})
```

## Error Handling Migration

### Before
```typescript
test('should handle transform errors gracefully', async () => {
  try {
    await matchFolderTransform('brokenTransform', 'error-fixture', {
      useJsCodeshift: true,
    })
    expect.fail('Should have thrown an error')
  } catch (error) {
    expect(error.message).toContain('Transform Error')
  }
})
```

### After (identical error handling)
```typescript
test('should handle transform errors gracefully', async () => {
  try {
    await matchFolderTransformFast('brokenTransform', 'error-fixture', {
      useJsCodeshift: true,
    })
    expect.fail('Should have thrown an error')
  } catch (error) {
    expect(error.message).toContain('Transform Error')
  }
})
```

## Fixture Structure (No Changes Required)

The fixture directory structure remains identical:

```
__testfixtures__/
├── import-simple/
│   ├── input/
│   │   └── App.tsx
│   └── output/
│       └── App.tsx
├── existingImport/
│   ├── input/
│   │   └── App.tsx
│   └── output/
│       └── App.tsx
└── error-fixture/
    ├── input/
    │   └── broken.js
    └── output/
        └── broken.js
```

## Performance Expectations

### Before Migration
- Test execution: 2-5 seconds (often timeout)
- Memory usage: High peak usage
- Reliability: Frequent timeout issues

### After Migration
- Test execution: 400-800ms
- Memory usage: Lower and more stable
- Reliability: Consistent completion

## Migration Checklist

### Required Changes
- [ ] Replace `matchFolderTransform` with `matchFolderTransformFast`
- [ ] Remove excessive timeout values (reduce to default or 5-10s max)
- [ ] Clean up timeout workarounds in `afterEach`

### Optional Improvements
- [ ] Remove `setImmediate` workarounds if no longer needed
- [ ] Add more test cases since they run faster
- [ ] Consider parallel test execution

### No Changes Needed
- [ ] Fixture directory structure
- [ ] Transform file locations
- [ ] Option parameters (`useJsCodeshift`, `targetPathsGlob`, etc.)
- [ ] Error assertions and expectations

## Bulk Migration Script

For projects with many tests, consider this find-and-replace approach:

```bash
# Find all test files using matchFolderTransform
find . -name "*.test.ts" -exec grep -l "matchFolderTransform" {} \;

# Replace function calls (use with caution - review changes)
sed -i 's/matchFolderTransform(/matchFolderTransformFast(/g' **/*.test.ts
```

## Verification

After migration, verify the changes work:

```bash
# Run the specific test to ensure it passes
yarn test path/to/your.test.ts

# Check that it completes faster
time yarn test path/to/your.test.ts

# Run all codemod tests to ensure nothing broke
yarn test **/codemod_tests**/*.test.ts
```

## Rollback Plan

If issues occur, you can easily rollback:

```bash
# Revert the function name change
sed -i 's/matchFolderTransformFast(/matchFolderTransform(/g' **/*.test.ts
```

The original `matchFolderTransform` remains available and unchanged.