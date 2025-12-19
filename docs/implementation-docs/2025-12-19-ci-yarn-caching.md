# Yarn Cache Verification Guide

## What Changed

We removed the deprecated `save-always: true` parameter from our cache configuration and updated the caching strategy to use unique keys with restore-keys fallbacks.

### Before (Deprecated)

```yaml
- name: ♻️ Restore yarn's cache
  uses: actions/cache@v4
  with:
    path: ${{ steps.get-yarn-cache-directory.outputs.CACHE_DIRECTORY }}
    key: yarn-cache-${{ runner.os }}
    save-always: true # ❌ Deprecated
```

### After (Current)

```yaml
- name: ♻️ Cache yarn's cache
  uses: actions/cache@v4
  with:
    path: ${{ steps.get-yarn-cache-directory.outputs.CACHE_DIRECTORY }}
    key: yarn-cache-${{ runner.os }}-${{ github.run_id }}
    restore-keys: |
      yarn-cache-${{ runner.os }}-
```

## How the New Caching Works

### Key Strategy

Each workflow run uses a **unique cache key** that includes `github.run_id`:

- Example: `yarn-cache-Linux-12345678`

This means:

1. **On Restore**: The exact key won't exist, so it falls back to `restore-keys`
2. **Restore-keys**: Matches the most recent cache with the prefix `yarn-cache-Linux-`
3. **On Save**: The unique key doesn't exist yet, so the save always succeeds
4. **Result**: Cache is restored from previous run AND saved for next run

### Three Caches

We maintain three separate caches:

1. **Yarn's Cache Directory** (`~/.yarn/berry/cache` or similar)
   - Contains downloaded package tarballs
   - Key: `yarn-cache-${{ runner.os }}-${{ github.run_id }}`
   - Accumulates packages over time

2. **Yarn's Install State** (`.yarn/install-state.gz`)
   - Tracks what's been installed
   - Key: `yarn-install-state-${{ runner.os }}-<lockfile-hash>-${{ github.run_id }}`
   - Changes when dependencies change

3. **node_modules**
   - The actual installed dependencies
   - Key: `yarn-node-modules-${{ runner.os }}-<lockfile-hash>-${{ github.run_id }}`
   - Changes when dependencies change

## How to Verify Caching is Working

### Method 1: Check GitHub Actions UI

1. Go to any workflow run in your repository
2. Click on a job that uses caching (e.g., "server-tests")
3. Expand the "🐈 Set up yarn cache" step
4. Look for these indicators:

**Cache Hit (Good - cache was restored):**

```
♻️ Cache yarn's cache
Cache restored from key: yarn-cache-Linux-12345677
```

**Cache Miss (First run or cache expired):**

```
♻️ Cache yarn's cache
Cache not found for input keys: yarn-cache-Linux-12345678
```

**Cache Saved (At end of job):**

```
Post job cleanup
Cache saved with key: yarn-cache-Linux-12345678
```

### Method 2: Compare Workflow Run Times

1. Look at the duration of `🐈 Yarn install` step
2. **With cache hit**: Should be fast (30 seconds - 2 minutes)
3. **Without cache**: Much slower (5-15 minutes depending on dependencies)

Example comparison:

- First run (no cache): `yarn install` takes 8 minutes
- Second run (with cache): `yarn install` takes 1 minute

### Method 3: Check Cache Storage in Repository Settings

1. Go to your repository on GitHub
2. Click "Settings" → "Actions" → "Caches"
3. You should see caches listed with names like:
   - `yarn-cache-Linux-12345678`
   - `yarn-install-state-Linux-abc123def-12345678`
   - `yarn-node-modules-Linux-abc123def-12345678`

### Method 4: Look at Yarn Output

When cache is working, yarn will show:

```
➤ YN0000: ┌ Resolution step
➤ YN0000: └ Completed in 0s 234ms
➤ YN0000: ┌ Fetch step
➤ YN0000: └ Completed in 0s 123ms (already cached)
➤ YN0000: ┌ Link step
➤ YN0000: └ Completed in 2s 456ms
```

Note the "already cached" and fast fetch times.

## Troubleshooting

### "Cache not found" on every run

**Symptom**: Every run shows "Cache not found" even though previous runs succeeded.

**Possible causes**:

1. Cache was evicted (GitHub keeps ~10GB per repo, older caches are deleted)
2. The `restore-keys` pattern isn't matching previous caches
3. Different runner OS (e.g., Linux vs Windows)

**To verify**: Check the cache storage in Settings → Actions → Caches

### Deprecation warnings still appearing

**Symptom**: Still seeing "save-always has been deprecated" in logs.

**Cause**: Using an old version of this action in some workflows.

**Solution**: Make sure all workflows are using the latest version of `.github/actions/set-up-yarn-cache`

### Yarn install still slow despite cache hit

**Symptom**: Cache is restored but `yarn install` still takes a long time.

**Possible causes**:

1. Cache is old and many new packages need to be downloaded
2. The `node_modules` cache isn't being restored (check that specific cache)
3. Yarn is re-linking packages (the link step can still take time)

**To investigate**: Look at the yarn output to see which step is slow (Resolution, Fetch, or Link)

## Expected Behavior

### On a typical workflow run (after first run):

1. **Cache Restore Phase**:
   - ✅ Yarn cache directory restored (most recent)
   - ✅ Yarn install state restored (matching lockfile hash)
   - ✅ node_modules restored (matching lockfile hash)

2. **Yarn Install**:
   - Resolution: Fast (< 1 second)
   - Fetch: Fast (< 1 second, "already cached")
   - Link: Moderate (1-3 seconds, needs to link modules)

3. **Cache Save Phase**:
   - ✅ Yarn cache directory saved with new unique key
   - ✅ Yarn install state saved with new unique key
   - ✅ node_modules saved with new unique key

### When dependencies change (package.json or yarn.lock modified):

1. **Cache Restore Phase**:
   - ✅ Yarn cache directory restored (from previous run)
   - ❌ Yarn install state NOT found (lockfile hash changed)
   - ❌ node_modules NOT found (lockfile hash changed)

2. **Yarn Install**:
   - Resolution: Fast (< 1 second)
   - Fetch: Moderate (downloads new/changed packages only)
   - Link: Slow (needs to rebuild node_modules)

3. **Cache Save Phase**:
   - ✅ All three caches saved with new keys

## Cache Lifecycle

- **Maximum age**: No explicit limit, but GitHub evicts old caches when storage limit is reached
- **Maximum size**: 10GB per repository (across all caches)
- **Eviction policy**: Least recently used (LRU)
- **Branches**: Caches are shared across branches in the same repository

## Why This Approach Works

1. **Unique keys ensure saves always succeed**: Can't fail with "cache already exists"
2. **restore-keys find the most recent cache**: Don't lose previous work
3. **No `save-always` needed**: The save happens automatically because the key is unique
4. **Efficient**: Only downloads what's new, reuses what's cached
5. **Maintains same behavior as before**: Just without the deprecation warning

## Testing the Changes

To test that the changes work:

1. Push a commit with these changes
2. Wait for CI to run and complete
3. Check the logs for "Cache restored from key: yarn-cache-..." (should show a restore)
4. Check that NO deprecation warnings appear
5. Trigger another workflow run
6. Verify the second run shows cache hits and is faster
7. Check Settings → Actions → Caches to see the stored caches
