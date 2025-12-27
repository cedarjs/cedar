// TODO: Remove this when https://github.com/streamich/unionfs/issues/809 is
// fixed
// TODO: Make this a TS file when we're on a new enough version of Vite and
// Vitest. See https://github.com/vitest-dev/vitest/issues/5999

/**
 * Wraps the fs module to avoid deprecation warnings when used with unionfs.
 * Replaces deprecated property getters (F_OK, R_OK, etc.) with proper constants
 *
 * Fixes "(node:37061) [DEP0176] DeprecationWarning: fs.F_OK is deprecated, use
 * fs.constants.F_OK instead"
 */
export function wrapFsForUnionfs(originalFs) {
  // Create a proxy that intercepts property access
  return new Proxy(originalFs, {
    get(target, prop) {
      // Redirect deprecated constants to fs.constants
      if (
        prop === 'F_OK' ||
        prop === 'R_OK' ||
        prop === 'W_OK' ||
        prop === 'X_OK'
      ) {
        return target.constants[prop]
      }

      return target[prop]
    },
  })
}
