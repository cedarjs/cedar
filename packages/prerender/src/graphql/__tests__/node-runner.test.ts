import path from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { NodeRunner } from '../node-runner.js'

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
  importStatementPath: vi.fn((path) => path),
  resolveFile: vi.fn(
    (
      filePath,
      extensions = ['.js', '.tsx', '.ts', '.jsx', '.mjs', '.mts', '.cjs'],
    ) => {
      const fs = require('fs')
      for (const extension of extensions) {
        const p = `${filePath}${extension}`
        if (fs.existsSync(p)) {
          return p
        }
      }
      return null
    },
  ),
}))

vi.mock('@cedarjs/jobs', () => ({
  jobs: {
    createJob: vi.fn((config) => ({
      ...config,
      __cedarJobConfig: config,
      run: vi.fn(),
    })),
  },
}))

describe('NodeRunner Integration Tests', () => {
  let nodeRunner: NodeRunner

  const fixturesDir = path.join(
    import.meta.dirname,
    '__fixtures__',
    'node-runner',
  )

  beforeEach(async () => {
    const mockContextPath = path.join(
      import.meta.dirname,
      '__fixtures__',
      'mocks',
      'context.js',
    )
    const mockGraphqlTagPath = path.join(
      import.meta.dirname,
      '__fixtures__',
      'mocks',
      'graphql-tag.js',
    )

    nodeRunner = new NodeRunner({
      resolve: {
        alias: [
          { find: '@cedarjs/context', replacement: mockContextPath },
          { find: 'graphql-tag', replacement: mockGraphqlTagPath },
        ],
      },
    })
  })

  afterEach(async () => {
    if (nodeRunner) {
      await nodeRunner.close()
    }
  })

  describe('importFile', () => {
    it('automatically initializes and imports ESM module', async () => {
      const modulePath = path.join(fixturesDir, 'test-modules', 'esm-module.js')

      const result = await nodeRunner.importFile(modulePath)

      expect(result).toMatchObject({
        namedExport: 'esm-value',
        default: 'esm-default',
      })
    })

    it('imports CommonJS module', async () => {
      const modulePath = path.join(fixturesDir, 'test-modules', 'cjs-module.js')

      const result = await nodeRunner.importFile(modulePath)

      expect(result).toHaveProperty('cjsExport', 'cjs-value')
      expect(result).toHaveProperty('handler')
      expect(typeof result.handler).toBe('function')
      expect(result.handler()).toBe('cjs-handler')
    })

    it('imports TypeScript module', async () => {
      const modulePath = path.join(fixturesDir, 'test-modules', 'ts-module.ts')

      const result = await nodeRunner.importFile(modulePath)

      expect(result).toHaveProperty('createUser')
      expect(result).toHaveProperty('default', 'typescript-default')
      expect(typeof result.createUser).toBe('function')

      const user = result.createUser('John Doe')
      expect(user).toHaveProperty('name', 'John Doe')
      expect(user).toHaveProperty('id')
      expect(typeof user.id).toBe('string')
    })

    it('handles GraphQL handler import', async () => {
      const gqlPath = path.join(
        fixturesDir,
        'cedar-app',
        'api',
        'src',
        'functions',
        'graphql.js',
      )

      const result = await nodeRunner.importFile(gqlPath)

      expect(result).toHaveProperty('handler')
      expect(typeof result.handler).toBe('function')

      // Test the handler functionality
      const mockEvent = {
        body: JSON.stringify({ query: '{ user { id name } }' }),
      }
      const mockContext = {}

      const response = await result.handler(mockEvent, mockContext)
      expect(response.statusCode).toBe(200)

      const responseBody = JSON.parse(response.body)
      expect(responseBody.data.user).toEqual({
        id: '1',
        name: 'Test User',
      })
    })

    it('handles trusted documents import', async () => {
      const documentsPath = path.join(
        fixturesDir,
        'cedar-app',
        'web',
        'src',
        'graphql',
        'graphql.js',
      )

      const result = await nodeRunner.importFile(documentsPath)

      expect(result.GetUserDocument).toEqual({
        __meta__: { hash: 'abc123hash' },
      })
      expect(result.UpdateUserDocument).toEqual({
        __meta__: { hash: 'def456hash' },
      })
    })

    it('handles import errors', async () => {
      const errorModulePath = path.join(
        fixturesDir,
        'test-modules',
        'error-module.js',
      )

      await expect(nodeRunner.importFile(errorModulePath)).rejects.toThrow(
        'Intentional error for testing',
      )
    })

    it('handles non-existent files', async () => {
      const nonExistentPath = path.join(
        fixturesDir,
        'test-modules',
        'non-existent.js',
      )

      await expect(nodeRunner.importFile(nonExistentPath)).rejects.toThrow()
    })

    it('handles empty modules', async () => {
      const emptyModulePath = path.join(
        fixturesDir,
        'test-modules',
        'empty-module.js',
      )

      const result = await nodeRunner.importFile(emptyModulePath)

      // Empty modules should return an empty object or undefined exports
      expect(result).toBeDefined()
    })

    it('reuses initialized runner for multiple imports', async () => {
      const esmPath = path.join(fixturesDir, 'test-modules', 'esm-module.js')
      const cjsPath = path.join(fixturesDir, 'test-modules', 'cjs-module.js')

      const [esmResult, cjsResult] = await Promise.all([
        nodeRunner.importFile(esmPath),
        nodeRunner.importFile(cjsPath),
      ])

      expect(esmResult.namedExport).toBe('esm-value')
      expect(cjsResult.cjsExport).toBe('cjs-value')
    })
  })

  describe('integration workflows', () => {
    it('simulates GraphQL handler workflow from graphql.ts', async () => {
      // This simulates how getGqlHandler works
      const gqlPath = path.join(
        fixturesDir,
        'cedar-app',
        'api',
        'src',
        'functions',
        'graphql.js',
      )

      try {
        const { handler } = await nodeRunner.importFile(gqlPath)

        const gqlHandler = async (operation: Record<string, unknown>) => {
          const event = {
            body: JSON.stringify(operation),
            headers: {
              'content-type': 'application/json',
            },
          }
          const context = {}

          return await handler(event, context)
        }

        const operation = {
          operationName: 'GetUser',
          query: '{ user { id name } }',
          variables: {},
        }

        const result = await gqlHandler(operation)

        expect(result.statusCode).toBe(200)
        const body = JSON.parse(result.body)
        expect(body.data.user.name).toBe('Test User')
      } catch (error) {
        throw new Error(`Unable to import GraphQL handler: ${error}`)
      }
    })

    it('simulates trusted documents workflow from executeQuery', async () => {
      // This simulates how executeQuery handles trusted documents
      const documentsPath = path.join(
        fixturesDir,
        'cedar-app',
        'web',
        'src',
        'graphql',
        'graphql.js',
      )

      const documents = await nodeRunner.importFile(documentsPath)

      const operationName = 'GetUser'
      const documentName =
        operationName[0].toUpperCase() + operationName.slice(1) + 'Document'
      const queryHash = documents?.[documentName]?.__meta__?.hash

      expect(queryHash).toBe('abc123hash')

      const operation = {
        operationName,
        query: undefined, // Would be undefined for trusted documents
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: queryHash,
          },
        },
      }

      expect(operation.extensions.persistedQuery.sha256Hash).toBe('abc123hash')
    })

    it('handles file path edge cases', async () => {
      // Test with absolute paths
      const absolutePath = path.resolve(
        fixturesDir,
        'test-modules',
        'esm-module.js',
      )
      const result = await nodeRunner.importFile(absolutePath)
      expect(result.namedExport).toBe('esm-value')

      // Test with normalized paths
      const unnormalizedPath = path.join(
        fixturesDir,
        'test-modules',
        '..',
        'test-modules',
        'esm-module.js',
      )
      const result2 = await nodeRunner.importFile(unnormalizedPath)
      expect(result2.namedExport).toBe('esm-value')
    })

    it('works with real Vite transformations', async () => {
      const tsPath = path.join(fixturesDir, 'test-modules', 'ts-module.ts')

      const result = await nodeRunner.importFile(tsPath)

      // TypeScript should be transformed to JavaScript
      expect(typeof result.createUser).toBe('function')

      // Test that TypeScript interfaces are properly handled
      const user = result.createUser('Jane')
      expect(user).toMatchObject({
        id: expect.any(String),
        name: 'Jane',
      })
    })

    describe('plugin functionality verification', () => {
      it('cedarImportDirPlugin - handles directory glob imports', async () => {
        const modulePath = path.join(
          fixturesDir,
          'test-modules',
          'import-dir-module.js',
        )

        const result = await nodeRunner.importFile(modulePath)

        expect(result.importedServices).toMatchObject({
          userService: {
            createUser: expect.any(Function),
            getUserById: expect.any(Function),
            userServiceName: 'userService',
          },
          post_post: {
            post: expect.any(Function),
            posts: expect.any(Function),
            createPost: expect.any(Function),
            postServiceName: 'postService',
          },
        })
      })

      it('autoImportsPlugin - provides gql and context without explicit imports', async () => {
        const modulePath = path.join(
          fixturesDir,
          'test-modules',
          'auto-import-module.js',
        )

        const result = await nodeRunner.importFile(modulePath)

        expect(result).toHaveProperty('testAutoImports')
        expect(typeof result.testAutoImports).toBe('function')

        const autoImportResults = await result.testAutoImports()

        // Verify gql is auto-imported and working
        expect(autoImportResults.hasGql).toBe(true)
        expect(result.query).toMatchObject({
          query: expect.any(String),
          __isGqlTemplate: true,
        })
        expect(result.mutation).toBeDefined()

        // Verify context is auto-imported
        expect(autoImportResults.hasContext).toBe(true)
        expect(autoImportResults.context).toMatchObject({
          currentUser: { id: 'test-user' },
        })
      })

      it.only('cedarCellTransform - transforms Cell components', async () => {
        const modulePath = path.join(
          fixturesDir,
          'test-modules',
          'UserCell.jsx',
        )

        const result = await nodeRunner.importFile(modulePath)

        // Verify Cell exports are present
        expect(result).toHaveProperty('QUERY')
        expect(result).toHaveProperty('Loading')
        expect(result).toHaveProperty('Empty')
        expect(result).toHaveProperty('Failure')
        expect(result).toHaveProperty('Success')

        // Verify components are functions
        expect(typeof result.Loading).toBe('function')
        expect(typeof result.Empty).toBe('function')
        expect(typeof result.Failure).toBe('function')
        expect(typeof result.Success).toBe('function')
      })

      it('cedarjsJobPathInjectorPlugin - handles job files without errors', async () => {
        // Test that the plugin can process files in the jobs directory
        // The actual path injection happens during transform, so we test basic functionality
        const modulePath = path.join(
          fixturesDir,
          'cedar-app',
          'api',
          'src',
          'jobs',
          'testJob.js',
        )

        // If the plugin fails, this import would throw an error
        // The test passes if the file can be imported successfully
        const result = await nodeRunner.importFile(modulePath)

        expect(result).toHaveProperty('testJob')
        expect(result).toHaveProperty('anotherTestJob')
        expect(result).toHaveProperty('simpleJob')

        // Verify basic job structure
        expect(typeof result.testJob).toBe('object')
        expect(typeof result.anotherTestJob).toBe('object')
        expect(typeof result.simpleJob).toBe('object')
      })

      it('cedarjsDirectoryNamedImportPlugin - resolves directory-based named imports', async () => {
        const modulePath = path.join(
          fixturesDir,
          'test-modules',
          'directory-named-import-module.js',
        )

        // If the plugin works, this should not throw
        const result = await nodeRunner.importFile(modulePath)

        expect(result).toHaveProperty('testDirectoryNamedImports')
        expect(result).toHaveProperty('importedModules')
        expect(typeof result.testDirectoryNamedImports).toBe('function')
      })

      it('cedarSwapApolloProvider - plugin loads without errors', async () => {
        // This test verifies the plugin can be included without issues
        // The actual Apollo provider swapping is tested in the plugin's own tests
        expect(nodeRunner).toBeDefined()

        // Verify that the plugin doesn't break basic functionality
        const modulePath = path.join(
          fixturesDir,
          'test-modules',
          'esm-module.js',
        )
        const result = await nodeRunner.importFile(modulePath)
        expect(result).toHaveProperty('namedExport', 'esm-value')
      })

      it('plugin interaction - multiple plugins work together', async () => {
        // Test a file that uses multiple plugin features
        const modulePath = path.join(
          fixturesDir,
          'test-modules',
          'auto-import-module.js',
        )

        const result = await nodeRunner.importFile(modulePath)

        // This tests that autoImportsPlugin and other plugins don't conflict
        expect(result.testAutoImports).toBeDefined()
        expect(result.gqlQuery).toBeDefined()
        expect(result.gqlMutation).toBeDefined()

        const autoImportResults = await result.testAutoImports()
        expect(autoImportResults.hasGql).toBe(true)
        expect(autoImportResults.hasContext).toBe(true)
      })
    })
  })
})
