const mockContextStore = new Map<string, any>()
const mockContext = new Proxy(
  {},
  {
    get: (_target, prop) => {
      // Handle toJSON() calls, i.e. JSON.stringify(context)
      if (prop === 'toJSON') {
        return () => mockContextStore.get('context')
      }
      return mockContextStore.get('context')[prop]
    },
    set: (_target, prop, value) => {
      const ctx = mockContextStore.get('context')
      ctx[prop] = value
      return true
    },
  },
)

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GlobalContext extends Record<string, unknown> {}

export const context = mockContext

export const setContext = (newContext: GlobalContext): GlobalContext => {
  console.log('calling mocked setContext')
  mockContextStore.set('context', newContext)
  return mockContext
}
