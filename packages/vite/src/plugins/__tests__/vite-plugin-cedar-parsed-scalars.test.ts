import type * as Vite from 'vite'
import type { HotUpdateOptions } from 'vite'
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

  it('builds the cache config into the virtual module and watches the schema', async () => {
    const { load } = getPlugin()
    const addWatchFile = vi.fn()

    const code = await callHook(
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

  it('leaves other modules alone', async () => {
    const { load } = getPlugin()

    expect(await callHook(load, {}, '/cedar-app/web/src/index.ts')).toBeNull()
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

  describe('hotUpdate', () => {
    const schemaPath = '/cedar-app/.cedar/schema.graphql'
    const virtualModule = { id: '\0virtual:cedar-parsed-scalars' }

    function callHotUpdate(
      file: string,
      type: HotUpdateOptions['type'],
      moduleGraph: {
        getModuleById: (id: string) => unknown
        invalidateModule: (mod: unknown) => void
      },
    ) {
      const { hotUpdate } = getPlugin()
      const options: HotUpdateOptions = {
        file,
        type,
        timestamp: Date.now(),
        modules: [],
        read: () => '',
        // A full `ViteDevServer` isn't needed since the hook only reads
        // `file`, `type` and `this.environment`
        server: {} as HotUpdateOptions['server'],
      }

      return callHook(hotUpdate, { environment: { moduleGraph } }, options)
    }

    it.each(['create', 'update', 'delete'] as const)(
      "reloads the virtual module for a schema '%s' event, invalidating its cached transform",
      (type) => {
        const getModuleById = vi.fn().mockReturnValue(virtualModule)
        const invalidateModule = vi.fn()

        const result = callHotUpdate(schemaPath, type, {
          getModuleById,
          invalidateModule,
        })

        expect(getModuleById).toHaveBeenCalledWith(virtualModule.id)
        expect(invalidateModule).toHaveBeenCalledWith(virtualModule)
        expect(result).toEqual([virtualModule])
      },
    )

    it('does nothing for a file other than the schema', () => {
      const getModuleById = vi.fn()
      const invalidateModule = vi.fn()

      const result = callHotUpdate('/cedar-app/web/src/App.tsx', 'update', {
        getModuleById,
        invalidateModule,
      })

      expect(getModuleById).not.toHaveBeenCalled()
      expect(result).toBeUndefined()
    })

    it('does nothing when the virtual module has not been loaded yet', () => {
      const invalidateModule = vi.fn()

      const result = callHotUpdate(schemaPath, 'create', {
        getModuleById: () => undefined,
        invalidateModule,
      })

      expect(invalidateModule).not.toHaveBeenCalled()
      expect(result).toBeUndefined()
    })
  })
})

// A separate suite, since it needs its own mock of `getPaths()` (a
// Windows-style path) and of `vite`'s `normalizePath` (real `isWindows`
// gating means it only converts backslashes when the test itself runs on
// Windows, which most CI jobs don't)
describe('cedarParsedScalarsPlugin hotUpdate on Windows-style paths', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('matches the schema path Vite reports (always forward slashes) against getPaths() (OS-native separators)', async () => {
    vi.doMock('vite', async (importOriginal) => ({
      ...(await importOriginal<typeof Vite>()),
      normalizePath: (id: string) => id.replace(/\\/g, '/'),
    }))
    vi.doMock('@cedarjs/project-config', () => ({
      getParsedScalars: () => ({ DateTime: 'Date' }),
      getPaths: () => ({
        generated: { schema: 'D:\\a\\cedar-app\\.cedar\\schema.graphql' },
      }),
    }))
    vi.doMock('@cedarjs/internal/dist/generate/parsedScalars.js', () => ({
      loadParsedScalarsCacheConfig: () => undefined,
    }))

    const { cedarParsedScalarsPlugin: plugin } =
      await import('../vite-plugin-cedar-parsed-scalars.js')
    const { hotUpdate } = plugin()!
    const virtualModule = { id: '\0virtual:cedar-parsed-scalars' }
    const getModuleById = vi.fn().mockReturnValue(virtualModule)
    const invalidateModule = vi.fn()

    const result = callHook(
      hotUpdate,
      { environment: { moduleGraph: { getModuleById, invalidateModule } } },
      {
        // What Vite's own watcher hands the hook: always forward slashes,
        // regardless of the OS
        file: 'D:/a/cedar-app/.cedar/schema.graphql',
        type: 'create',
      } as never,
    )

    expect(invalidateModule).toHaveBeenCalledWith(virtualModule)
    expect(result).toEqual([virtualModule])
  })
})
