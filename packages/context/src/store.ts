import { AsyncLocalStorage } from 'async_hooks'

import type { GlobalContext } from './context.js'

// The singleton lives on `globalThis` (keyed by a registered Symbol) so the
// ESM and CJS variants of this package share the same `AsyncLocalStorage`
// instance.
//
// `@cedarjs/context` ships dual ESM+CJS, and Node resolves the variant per
// caller — ESM consumers (e.g. an ESM user-api package) load `dist/index.js`,
// CJS consumers (e.g. cedar's CLI loading `@cedarjs/api-server`'s CJS entry)
// load `dist/cjs/index.js`. Each variant is a separate module instance with
// its own module-scoped state. If we kept the `AsyncLocalStorage` in a
// module-scoped `let`, each variant would have its own store, and the
// `currentUser` written into one would be invisible to the other — a
// classic dual-package hazard. Stashing it on `globalThis` under a
// `Symbol.for` key bridges them: both variants resolve the same key to the
// same object, so they share the store and `context.currentUser` propagates
// between framework code and user code regardless of which variant each
// loaded.
const STORAGE_KEY = Symbol.for('__cedarjs_context_storage__')

type ContextStorageGlobal = typeof globalThis & {
  [STORAGE_KEY]?: AsyncLocalStorage<Map<string, GlobalContext>>
}

/**
 * This returns a AsyncLocalStorage instance, not the actual store.
 * Should not be used by Redwood apps directly. The framework handles
 * this.
 */
export const getAsyncStoreInstance = () => {
  const g = globalThis as ContextStorageGlobal

  if (!g[STORAGE_KEY]) {
    g[STORAGE_KEY] = new AsyncLocalStorage<Map<string, GlobalContext>>()
  }

  return g[STORAGE_KEY]
}
