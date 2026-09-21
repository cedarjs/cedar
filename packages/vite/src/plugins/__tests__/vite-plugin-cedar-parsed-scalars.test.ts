import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadParsedScalarsCacheConfig } from '@cedarjs/internal/dist/generate/parsedScalars.js'
import { getParsedScalars } from '@cedarjs/project-config'

import { cedarParsedScalarsPlugin } from '../vite-plugin-cedar-parsed-scalars.js'

vi.mock('@cedarjs/project-config', () => ({
  getParsedScalars: vi.fn(),
  getPaths: () => ({
    generated: { schema: '/cedar-app/.cedar/schema.graphql' },
  }),
}))

vi.mock('@cedarjs/internal/dist/generate/parsedScalars.js', () => ({
  loadParsedScalarsCacheConfig: vi.fn(),
}))

const cacheConfig = {
  scalars: { DateTime: 'Date' },
  typePolicies: { Post: { fields: { postedAt: { scalar: 'DateTime' } } } },
  inputObjects: {},
}

function getPlugin() {
  const plugin = cedarParsedScalarsPlugin()

  if (!plugin) {
    throw new Error('Expected the plugin to be created')
  }

  return plugin
}

// The hooks only use the parts of the context that the tests provide
function callHook<T extends (...args: never[]) => unknown>(
  hook: unknown,
  context: object,
  ...args: Parameters<T>
) {
  if (typeof hook !== 'function') {
    throw new Error('Expected the hook to be a function')
  }

  return hook.call(context, ...args)
}

describe('cedarParsedScalarsPlugin', () => {
  beforeEach(() => {
    vi.mocked(getParsedScalars).mockReturnValue({ DateTime: 'Date' })
    vi.mocked(loadParsedScalarsCacheConfig).mockReturnValue(cacheConfig)
  })

  it('does nothing when no scalar is parsed', () => {
    vi.mocked(getParsedScalars).mockReturnValue({})

    expect(cedarParsedScalarsPlugin()).toBeUndefined()
  })

  it('does not swallow the error for a setting Cedar does not support', () => {
    vi.mocked(getParsedScalars).mockImplementation(() => {
      throw new Error('"Temporal" is not a supported value')
    })

    expect(() => cedarParsedScalarsPlugin()).toThrow('"Temporal"')
  })

  it('resolves the virtual module', () => {
    const { resolveId } = getPlugin()

    expect(
      callHook(resolveId, {}, 'virtual:cedar-parsed-scalars', undefined, {}),
    ).toBe('\0virtual:cedar-parsed-scalars')
    expect(callHook(resolveId, {}, './other', undefined, {})).toBeNull()
  })

  it('builds the cache config into the virtual module and watches the schema', () => {
    const { load } = getPlugin()
    const addWatchFile = vi.fn()

    const code = callHook(
      load,
      { addWatchFile },
      '\0virtual:cedar-parsed-scalars',
    )

    expect(code).toBe(
      `globalThis.__CEDAR__PARSED_SCALARS = ${JSON.stringify(cacheConfig)}`,
    )
    expect(addWatchFile).toHaveBeenCalledWith(
      '/cedar-app/.cedar/schema.graphql',
    )
  })

  it('leaves other modules alone', () => {
    const { load } = getPlugin()

    expect(callHook(load, {}, '/cedar-app/web/src/index.ts')).toBeNull()
  })

  it.each([
    '/cedar-app/web/src/App.tsx',
    '/cedar-app/web/src/App.jsx',
    '/cedar-app/web/src/App.ts',
    '/cedar-app/web/src/App.js',
    'C:\\cedar-app\\web\\src\\App.tsx',
  ])('imports the virtual module in %s', (id) => {
    const { transform } = getPlugin()

    expect(callHook(transform, {}, 'export default App', id)).toBe(
      "import 'virtual:cedar-parsed-scalars'\nexport default App",
    )
  })

  it.each([
    '/cedar-app/node_modules/@cedarjs/testing/dist/web/vitest/vitest-web.setup.js',
    '/cedar-framework/packages/testing/src/web/vitest/vitest-web.setup.ts',
  ])('imports the virtual module in the web test setup file %s', (id) => {
    const { transform } = getPlugin()

    expect(callHook(transform, {}, 'beforeAll(() => {})', id)).toBe(
      "import 'virtual:cedar-parsed-scalars'\nbeforeAll(() => {})",
    )
  })

  it.each([
    '/cedar-app/web/src/components/App.tsx',
    '/cedar-app/web/src/Apps.tsx',
    '/cedar-app/web/src/pages/HomePage/HomePage.tsx',
  ])('does not touch %s', (id) => {
    const { transform } = getPlugin()

    expect(callHook(transform, {}, 'export default App', id)).toBeNull()
  })
})
