const mockContextStore = new Map<string, GlobalContext>()
const mockContext = new Proxy(
  {},
  {
    get: (_target, prop) => {
      // Handle toJSON() calls, i.e. JSON.stringify(context)
      if (prop === 'toJSON') {
        return () => mockContextStore.get('context')
      }

      const ctx = mockContextStore.get('context')

      if (!ctx) {
        return undefined
      }

      return ctx[prop]
    },
    set: (_target, prop, value) => {
      const ctx = mockContextStore.get('context')

      if (!ctx) {
        return false
      }

      ctx[prop] = value

      return true
    },
  },
)

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GlobalContext extends Record<string, unknown> {}

export const context = mockContext

export const setContext = (newContext: GlobalContext): GlobalContext => {
  mockContextStore.set('context', newContext)
  // Intentionally returns `mockContext` (the Proxy), not `newContext`.
  // Production's `setContext` also returns a Proxy (a freshly-created one
  // wrapping newContext), not the raw object — see packages/context/src/context.ts.
  // Both proxies read from their store dynamically on every access, so old
  // and new proxy instances are behaviorally interchangeable; the important
  // invariant `context === setContext(x)` holds here exactly like it does
  // in production. Returning `newContext` (a plain object, not a Proxy)
  // would actually break that parity. No callers currently use the return
  // value, but keep this correct for anyone who starts relying on it.
  return mockContext
}
