import path from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@cedarjs/project-config', () => ({
  getPaths: vi.fn(() => {
    const appFixtureDir = path.join(
      import.meta.dirname,
      '__fixtures__',
      'node-runner',
      'cedar-app',
    )

    return {
      api: {
        base: path.join(appFixtureDir, 'api'),
        src: path.join(appFixtureDir, 'api', 'src'),
        functions: path.join(appFixtureDir, 'api', 'src', 'functions'),
        jobs: path.join(appFixtureDir, 'api', 'src', 'jobs'),
      },
      web: {
        src: path.join(appFixtureDir, 'web', 'src'),
        graphql: path.join(appFixtureDir, 'web', 'src', 'graphql'),
      },
    }
  }),
  projectIsEsm: vi.fn(() => true),
  getConfig: vi.fn(() => ({
    experimental: {
      streamingSsr: {
        enabled: false,
      },
    },
  })),
}))

describe('NodeRunner - Simplified CJS/ESM Resolution', () => {
  beforeEach(() => {
    globalThis.RWJS_ENV = {
      RWJS_API_GRAPHQL_URL: 'http://localhost:8911/graphql',
      RWJS_API_URL: 'http://localhost:8911',
      __REDWOOD__APP_TITLE: 'Test App',
    }
  })

  afterEach(() => {
    delete globalThis.RWJS_ENV
  })

  it('validates conditional exports work without explicit @cedarjs/vite alias', async () => {
    const { NodeRunner } = await import('../node-runner.js')

    // Test CJS-favoring conditions
    const cjsNodeRunner = new NodeRunner({
      resolve: {
        alias: [
          {
            find: '@cedarjs/context',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'context.js',
            ),
          },
          {
            find: 'graphql-tag',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'graphql-tag.js',
            ),
          },
          {
            find: '@cedarjs/web',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'web.js',
            ),
          },
        ],
        conditions: ['require', 'node', 'default'],
      },
      ssr: {
        target: 'node',
        resolve: {
          conditions: ['require', 'node', 'default'],
          externalConditions: ['require', 'node'],
        },
        external: ['@babel/generator', '@babel/traverse', '@babel/parser'],
      },
    })

    try {
      const cellPath = path.join(
        import.meta.dirname,
        '__fixtures__',
        'node-runner',
        'test-modules',
        'UserCell.jsx',
      )

      const result = await cjsNodeRunner.importFile(cellPath)

      // Verify Cell transformation works
      expect(result).toHaveProperty('default')
      expect(typeof result.default).toBe('function')
      expect(result.default.displayName).toBe('UserCell')

      // Verify original exports are preserved
      expect(result).toHaveProperty('QUERY')
      expect(result).toHaveProperty('Loading')
      expect(result).toHaveProperty('Empty')
      expect(result).toHaveProperty('Failure')
      expect(result).toHaveProperty('Success')

      // Verify the wrapper contains original exports
      expect(result.default.QUERY).toBe(result.QUERY)
      expect(result.default.Loading).toBe(result.Loading)
      expect(result.default.Empty).toBe(result.Empty)
      expect(result.default.Failure).toBe(result.Failure)
      expect(result.default.Success).toBe(result.Success)

      console.log('✅ CJS conditional exports work without explicit alias')
    } finally {
      await cjsNodeRunner.close()
    }
  })

  it('compares CJS vs ESM resolution in same process', async () => {
    const { NodeRunner } = await import('../node-runner.js')

    const sharedConfig = {
      resolve: {
        alias: [
          {
            find: '@cedarjs/context',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'context.js',
            ),
          },
          {
            find: 'graphql-tag',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'graphql-tag.js',
            ),
          },
          {
            find: '@cedarjs/web',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'web.js',
            ),
          },
        ],
      },
    }

    // ESM-favoring configuration
    const esmRunner = new NodeRunner({
      ...sharedConfig,
      resolve: {
        ...sharedConfig.resolve,
        conditions: ['import', 'module', 'node', 'default'],
      },
      ssr: {
        target: 'node',
        resolve: {
          conditions: ['import', 'module', 'node', 'default'],
          externalConditions: ['import', 'module', 'node'],
        },
      },
    })

    // CJS-favoring configuration
    const cjsRunner = new NodeRunner({
      ...sharedConfig,
      resolve: {
        ...sharedConfig.resolve,
        conditions: ['require', 'node', 'default'],
      },
      ssr: {
        target: 'node',
        resolve: {
          conditions: ['require', 'node', 'default'],
          externalConditions: ['require', 'node'],
        },
        external: ['@babel/generator', '@babel/traverse', '@babel/parser'],
      },
    })

    try {
      const cellPath = path.join(
        import.meta.dirname,
        '__fixtures__',
        'node-runner',
        'test-modules',
        'UserCell.jsx',
      )

      const [esmResult, cjsResult] = await Promise.all([
        esmRunner.importFile(cellPath),
        cjsRunner.importFile(cellPath),
      ])

      // Both should succeed
      expect(esmResult).toHaveProperty('default')
      expect(cjsResult).toHaveProperty('default')

      // Both should have same structure
      expect(esmResult.default?.displayName).toBe('UserCell')
      expect(cjsResult.default?.displayName).toBe('UserCell')

      // Both should have the same exports
      const esmExports = Object.keys(esmResult).sort()
      const cjsExports = Object.keys(cjsResult).sort()
      expect(esmExports).toEqual(cjsExports)

      // Verify both have all Cell lifecycle methods
      const expectedExports = [
        'QUERY',
        'Loading',
        'Empty',
        'Failure',
        'Success',
        'default',
      ]
      for (const exportName of expectedExports) {
        expect(esmResult).toHaveProperty(exportName)
        expect(cjsResult).toHaveProperty(exportName)
      }

      // Verify createCell wrapper works in both
      expect(esmResult.default.QUERY).toBe(esmResult.QUERY)
      expect(cjsResult.default.QUERY).toBe(cjsResult.QUERY)
      expect(esmResult.default.Success).toBe(esmResult.Success)
      expect(cjsResult.default.Success).toBe(cjsResult.Success)

      console.log('✅ Both ESM and CJS conditional resolution work identically')
    } finally {
      await Promise.all([esmRunner.close(), cjsRunner.close()])
    }
  })

  it('validates babel import resolution differences', async () => {
    const { NodeRunner } = await import('../node-runner.js')

    const sharedAliases = [
      {
        find: '@cedarjs/context',
        replacement: path.join(
          import.meta.dirname,
          '__fixtures__',
          'mocks',
          'context.js',
        ),
      },
      {
        find: 'graphql-tag',
        replacement: path.join(
          import.meta.dirname,
          '__fixtures__',
          'mocks',
          'graphql-tag.js',
        ),
      },
      {
        find: '@cedarjs/web',
        replacement: path.join(
          import.meta.dirname,
          '__fixtures__',
          'mocks',
          'web.js',
        ),
      },
    ]

    // Test different resolution strategies that might affect babel
    const testConfigs = [
      {
        name: 'Prefer require() conditions (CJS)',
        config: {
          resolve: {
            alias: sharedAliases,
            conditions: ['require', 'node', 'default'],
          },
          ssr: {
            target: 'node',
            resolve: {
              conditions: ['require', 'node', 'default'],
              externalConditions: ['require', 'node'],
            },
            external: ['@babel/generator', '@babel/traverse', '@babel/parser'],
          },
        },
      },
      {
        name: 'Prefer import conditions (ESM)',
        config: {
          resolve: {
            alias: sharedAliases,
            conditions: ['import', 'module', 'node', 'default'],
          },
          ssr: {
            target: 'node',
            resolve: {
              conditions: ['import', 'module', 'node', 'default'],
              externalConditions: ['import', 'module', 'node'],
            },
          },
        },
      },
      {
        name: 'Mixed conditions (fallback)',
        config: {
          resolve: {
            alias: sharedAliases,
            conditions: ['import', 'require', 'module', 'node', 'default'],
          },
          ssr: {
            target: 'node',
            resolve: {
              conditions: ['node', 'require', 'default'],
              externalConditions: ['node', 'require'],
            },
          },
        },
      },
    ]

    const results = []

    for (const { name, config } of testConfigs) {
      const nodeRunner = new NodeRunner(config)

      try {
        const cellPath = path.join(
          import.meta.dirname,
          '__fixtures__',
          'node-runner',
          'test-modules',
          'UserCell.jsx',
        )

        // This should not throw babel import errors regardless of resolution strategy
        const result = await nodeRunner.importFile(cellPath)

        expect(result).toHaveProperty('default')
        expect(result.default?.displayName).toBe('UserCell')

        results.push({
          name,
          success: true,
          exportCount: Object.keys(result).length,
          hasAllExports: !!(result.QUERY && result.Loading && result.Success),
        })

        console.log(`${name}: ✅ Babel imports work correctly`)
      } catch (error) {
        console.error(`${name}: ❌ Failed with error:`, error.message)
        throw new Error(`${name} failed: ${error.message}`)
      } finally {
        await nodeRunner.close()
      }
    }

    // All configurations should work
    expect(results).toHaveLength(3)
    expect(results.every((r) => r.success)).toBe(true)
    expect(results.every((r) => r.hasAllExports)).toBe(true)

    console.log('✅ All resolution strategies work with babel imports')
  })

  it('validates production-like scenario without explicit vite alias', async () => {
    const { NodeRunner } = await import('../node-runner.js')

    // Production-like configuration that relies purely on conditional exports
    const productionRunner = new NodeRunner({
      root: process.cwd(),
      resolve: {
        alias: [
          {
            find: '@cedarjs/context',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'context.js',
            ),
          },
          {
            find: 'graphql-tag',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'graphql-tag.js',
            ),
          },
          {
            find: '@cedarjs/web',
            replacement: path.join(
              import.meta.dirname,
              '__fixtures__',
              'mocks',
              'web.js',
            ),
          },
        ],
        conditions: ['node', 'require', 'production', 'default'],
      },
      ssr: {
        target: 'node',
        resolve: {
          conditions: ['node', 'require', 'production'],
          externalConditions: ['node', 'require'],
        },
        external: [
          '@babel/generator',
          '@babel/traverse',
          '@babel/parser',
          'react',
          'react-dom',
        ],
      },
      mode: 'production',
      define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.BABEL_ENV': '"production"',
      },
      optimizeDeps: {
        disabled: true,
      },
      logLevel: 'warn',
    })

    try {
      const cellPath = path.join(
        import.meta.dirname,
        '__fixtures__',
        'node-runner',
        'test-modules',
        'UserCell.jsx',
      )

      const startTime = Date.now()
      const result = await productionRunner.importFile(cellPath)
      const transformTime = Date.now() - startTime

      // Verify production transformation
      expect(result).toHaveProperty('default')
      expect(result.default?.displayName).toBe('UserCell')
      expect(typeof result.default).toBe('function')

      // Verify all cell lifecycle exports
      const expectedExports = [
        'QUERY',
        'Loading',
        'Empty',
        'Failure',
        'Success',
        'default',
      ]
      for (const exportName of expectedExports) {
        expect(result).toHaveProperty(exportName)
      }

      // Verify createCell wrapper
      expect(result.default.QUERY).toBe(result.QUERY)
      expect(result.default.Loading).toBe(result.Loading)
      expect(result.default.Empty).toBe(result.Empty)
      expect(result.default.Failure).toBe(result.Failure)
      expect(result.default.Success).toBe(result.Success)

      console.log(
        `✅ Production scenario works without explicit alias (${transformTime}ms)`,
      )
    } finally {
      await productionRunner.close()
    }
  })
})
