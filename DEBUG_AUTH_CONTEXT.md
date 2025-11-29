# Debugging Auth Context Issue

## Problem Description

After the Prisma config changes in PR #547, the `context` object in `api/src/lib/auth.ts` is empty even though:

- The user is logged in
- `getCurrentUser()` successfully retrieves the user from the database
- dbAuth is properly configured

## Changes Made in This PR

The main change that could affect runtime is in `packages/api-server/src/watch.ts`:

- `startWatch()` function was changed to `async` to call `await getDbDir()`
- This is needed to load the Prisma config file dynamically

## Fix Applied

1. **Added `await` to `startWatch()` call** in `packages/api-server/src/watch.ts:159`
   - This was missing and could cause a race condition during startup

## Debugging Steps

### Step 1: Enable Debug Logging

Run your dev server with the `DEBUG_CONTEXT` environment variable:

```bash
DEBUG_CONTEXT=true yarn cedar dev
```

This will output detailed logs about:

- When `setContext()` is called (should happen during GraphQL context building)
- What data is being set (should include `currentUser`)
- When the context proxy getter is accessed (when your auth functions run)
- Whether AsyncLocalStorage has a valid store

### Step 2: Check the Debug Output

You should see output like:

```
[setContext Debug] {
  hasNewContext: true,
  contextKeys: [ 'currentUser', 'event', ... ],
  currentUser: { id: 1, email: 'user@example.com', ... }
}
[setContext Debug - Store] {
  hasStore: true,
  storeHasContext: true
}
```

Then later when your auth functions run:

```
[Context Debug] {
  property: 'currentUser',
  hasStore: true,
  hasContext: true,
  contextKeys: [ 'currentUser', 'event', ... ],
  currentUser: { id: 1, email: 'user@example.com', ... }
}
```

### Step 3: Diagnose Based on Output

#### If `setContext` shows `hasStore: false`

This means AsyncLocalStorage doesn't have a store when `setContext` is called. This could happen if:

- The GraphQL Yoga server isn't properly creating the async context
- There's a module resolution issue with `@cedarjs/context`

**Fix**: Check that `@cedarjs/context` is only installed once:

```bash
find . -name '@cedarjs' -type d | grep context
```

#### If `setContext` is called but context getter shows `hasStore: false`

This means the async context is being lost between when it's set and when it's accessed. This could happen if:

- There's an async boundary that's not being properly handled
- Prisma config loading is happening in a way that breaks async context

**Fix**: Check if the Prisma config is being loaded during request handling by adding logging to `packages/project-config/src/prisma.ts`:

```typescript
export async function loadPrismaConfig(prismaConfigPath: string) {
  console.log(
    '[loadPrismaConfig] Loading config from:',
    prismaConfigPath,
    new Error().stack,
  )
  // ... rest of function
}
```

#### If both show stores but context is empty

This would indicate the context is being set in one AsyncLocalStorage instance and read from another.

**Fix**: Verify there's only one instance of `@cedarjs/context` in your node_modules.

### Step 4: Check AsyncLocalStorage Directly

Add this to your `auth.ts` temporarily:

```typescript
import { getAsyncStoreInstance } from '@cedarjs/context/store'

export const isAuthenticated = (): boolean => {
  const store = getAsyncStoreInstance().getStore()
  console.log('[isAuthenticated] Store:', {
    hasStore: !!store,
    context: store?.get('context'),
  })
  return !!context.currentUser
}
```

## Potential Root Causes

### 1. Race Condition During Startup (FIXED)

The missing `await` on `startWatch()` could cause the server to start before initialization is complete.

### 2. Module Duplication

If `@cedarjs/context` is installed in multiple locations, each would have its own AsyncLocalStorage instance.

### 3. Dynamic Import Breaking Async Context

The `await import()` in `loadPrismaConfig` could potentially break async context if it's called during request handling (though it should be cached after first load).

## Quick Test

Try this minimal test to verify AsyncLocalStorage is working:

```typescript
// Add to api/src/functions/graphql.ts
import { getAsyncStoreInstance } from '@cedarjs/context/store'

export const handler = createGraphQLHandler({
  // ... existing config
  context: () => {
    const store = getAsyncStoreInstance().getStore()
    console.log('[GraphQL Handler Context] Store exists:', !!store)
    return {}
  },
})
```

## Next Steps

1. Run with `DEBUG_CONTEXT=true` and share the output
2. Check for duplicate `@cedarjs/context` installations
3. Verify the Prisma config is only loaded during startup, not during requests
4. If still not working, we may need to check if there's an issue with how the bin files are being executed

## Files Modified

- `packages/api-server/src/watch.ts` - Added missing `await` to `startWatch()` call
- `packages/context/src/context.ts` - Added debug logging (can be removed after issue is resolved)
