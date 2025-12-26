# Test Fixture: Test Files Exclusion

This fixture is used to test that the GraphQL schema generator correctly excludes test and spec files from the `directives/` and `subscriptions/` directories.

## Problem Being Tested

Previously, the schema generator would load ALL `.js` and `.ts` files from these directories, including test files (`.test.ts`, `.test.js`, `.spec.ts`, `.spec.js`). This caused Node.js warnings when attempting to import ES module test files in a CommonJS context.

## Fixture Structure

```
api/
├── src/
│   ├── directives/
│   │   ├── requireAuth/
│   │   │   ├── requireAuth.ts          ✅ Should be INCLUDED in schema
│   │   │   └── requireAuth.test.ts     ❌ Should be EXCLUDED from schema
│   │   └── skipAuth/
│   │       ├── skipAuth.js             ✅ Should be INCLUDED in schema
│   │       └── skipAuth.spec.js        ❌ Should be EXCLUDED from schema
│   ├── subscriptions/
│   │   ├── countdown/
│   │   │   ├── countdown.ts            ✅ Should be INCLUDED in schema
│   │   │   └── countdown.test.ts       ❌ Should be EXCLUDED from schema
│   │   └── newMessage/
│   │       ├── newMessage.js           ✅ Should be INCLUDED in schema
│   │       └── newMessage.spec.js      ❌ Should be EXCLUDED from schema
│   └── graphql/
│       └── todos.sdl.ts                ✅ Should be INCLUDED in schema
└── db/
    └── schema.prisma
```

## What Tests Verify

1. **No Warnings**: Test files don't cause ES module import warnings
2. **Directives Included**: `@requireAuth` and `@skipAuth` directives are in the generated schema
3. **Subscriptions Included**: `countdown` and `newMessage` subscriptions are in the generated schema
4. **Test Content Excluded**: Exports from test files (like `thisFileShouldNotBeLoaded`) are NOT in the schema
5. **Complete Schema**: Snapshot test ensures the full schema is generated correctly

## Related Code

The fix is implemented in `packages/internal/src/generate/graphqlSchema.ts` via glob negation patterns:

```typescript
const schemaPointerMap = {
  // ... other patterns ...
  "directives/**/*.{js,ts}": {},
  "!directives/**/*.test.{js,ts}": {},    // Exclude test files
  "!directives/**/*.spec.{js,ts}": {},    // Exclude spec files
  "subscriptions/**/*.{js,ts}": {},
  "!subscriptions/**/*.test.{js,ts}": {}, // Exclude test files
  "!subscriptions/**/*.spec.{js,ts}": {}, // Exclude spec files
}
```

## Test Files

The corresponding tests are in `packages/internal/src/__tests__/graphqlSchema.test.ts`:

- `Does not generate warnings when loading schema with test files present`
- `Excludes .test.ts and .spec.js files from directives directory`
- `Excludes .test.ts and .spec.js files from subscriptions directory`
- `Generates complete schema with directives and subscriptions while excluding test files`
