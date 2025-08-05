import path from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { NodeRunner } from '../node-runner.js'

const mocks = vi.hoisted(() => {
  return {
    experimental: null as any,
    graphql: null as any,
  }
})

vi.mock('@cedarjs/project-config', async () => {
  const fs = await import('node:fs')
  const actual = await vi.importActual<typeof ProjectConfig>(
    '@cedarjs/project-config',
  )

  return {
    ...actual,
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
          base: path.join(appFixtureDir, 'web'),
          src: path.join(appFixtureDir, 'web', 'src'),
          graphql: path.join(appFixtureDir, 'web', 'src', 'graphql'),
        },
      }
    }),
    projectIsEsm: () => true,
    getConfig: () => {
      return {
        experimental: mocks.experimental
          ? mocks.experimental
          : {
              streamingSsr: {
                enabled: false,
              },
            },
        graphql: mocks.graphql,
      }
    },
    resolveFile: (
      filePath: string,
      extensions = ['.js', '.tsx', '.ts', '.jsx', '.mjs', '.mts', '.cjs'],
    ) => {
      for (const extension of extensions) {
        const p = `${filePath}${extension}`

        if (fs.existsSync(p)) {
          return p
        }
      }

      return null
    },
  }
})

describe('NodeRunner', () => {
  let nodeRunner: NodeRunner

  const fixturesDir = path.join(
    import.meta.dirname,
    '__fixtures__',
    'node-runner',
  )

  beforeEach(async () => {
    // Set up RWJS_ENV global for Cell transformations
    globalThis.RWJS_ENV = {
      RWJS_API_GRAPHQL_URL: 'http://localhost:8911/graphql',
      RWJS_API_URL: 'http://localhost:8911',
      __REDWOOD__APP_TITLE: 'Test App',
    }

    const mocksDir = path.join(import.meta.dirname, '__fixtures__', 'mocks')
    const mockContextPath = path.join(mocksDir, 'context.js')
    const mockWebPath = path.join(mocksDir, 'web.js')

    nodeRunner = new NodeRunner({
      resolve: {
        alias: [
          { find: '@cedarjs/context', replacement: mockContextPath },
          { find: /^@cedarjs\/web$/, replacement: mockWebPath },
        ],
      },
    })
  })

  afterEach(async () => {
    if (nodeRunner) {
      await nodeRunner.close()
    }
    mocks.experimental = null
    mocks.graphql = null
  })

  it('imports ESM module', async () => {
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
    it('uses cedarImportDirPlugin to handle directory glob imports', async () => {
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

    it('uses autoImportsPlugin to provide gql and context without explicit imports', async () => {
      const modulePath = path.join(
        fixturesDir,
        'test-modules',
        'web',
        'src',
        'auto-import-module.js',
      )

      const result = await nodeRunner.importFile(modulePath)

      expect(result).toHaveProperty('testAutoImports')
      expect(typeof result.testAutoImports).toBe('function')

      const autoImportResults = await result.testAutoImports()

      // Verify gql is auto-imported and working
      expect(autoImportResults.hasGql).toBe(true)
      expect(result.query).toMatchObject({
        kind: 'Document',
        definitions: expect.any(Array),
      })
      expect(result.mutation).toBeDefined()

      // Verify context is auto-imported
      expect(autoImportResults.hasContext).toBe(true)
      expect(autoImportResults.context).toMatchObject({
        currentUser: { id: 'test-user' },
      })
    })

    it('uses different gql template function for trusted documents', async () => {
      mocks.graphql = {
        trustedDocuments: true,
      }

      const modulePath = path.join(
        fixturesDir,
        'test-modules',
        'web',
        'src',
        'auto-import-module.js',
      )

      const result = await nodeRunner.importFile(modulePath)

      expect(result.blogPostQuery).toMatchObject({
        __meta__: { hash: '46e9823d95110ebb2ef17ef82fff5c19a468f8a6' },
        kind: 'Document',
        definitions: expect.any(Array),
      })
    })

    it('uses cedarCellTransform to transform Cell components', async () => {
      const modulePath = path.join(
        fixturesDir,
        'test-modules',
        'web',
        'src',
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

      // Verify that the cell has been wrapped with createCell
      expect(result).toHaveProperty('default')
      expect(typeof result.default).toBe('function')

      // Verify the createCell wrapper has the expected displayName
      expect(result.default).toHaveProperty('displayName', 'UserCell')

      // Verify the createCell wrapper contains all the original exports
      expect(result.default.QUERY).toBe(result.QUERY)
      expect(result.default.Loading).toBe(result.Loading)
      expect(result.default.Empty).toBe(result.Empty)
      expect(result.default.Failure).toBe(result.Failure)
      expect(result.default.Success).toBe(result.Success)

      // Verify that QUERY contains the expected GraphQL structure
      expect(result.QUERY).toMatchObject({
        kind: 'Document',
        definitions: expect.any(Array),
        loc: expect.any(Object),
      })
      expect(result.QUERY.loc.source.body).toContain('query FindUser')
    })

    it.skip('uses cedarjsJobPathInjectorPlugin to handle job files without errors', async () => {
      const modulePath = path.join(
        fixturesDir,
        'cedar-app',
        'api',
        'src',
        'jobs',
        'testJob.js',
      )

      const result = await nodeRunner.importFile(modulePath)

      expect(typeof result.testJob).toBe('object')
      expect(typeof result.anotherTestJob).toBe('object')
      expect(result.simpleJob).toMatchObject({
        name: 'simpleJob',
        path: 'testJob',
        perform: expect.any(Function),
        queue: 'low-priority',
      })
    })

    it('uses cedarjsDirectoryNamedImportPlugin to resolve directory-based named imports', async () => {
      const modulePath = path.join(
        fixturesDir,
        'test-modules',
        'directory-named-import-module.js',
      )

      const result = await nodeRunner.importFile(modulePath)

      expect(result).toHaveProperty('testDirectoryNamedImports')
      const importsTest = result.testDirectoryNamedImports()
      expect(importsTest).toMatchObject({
        canCallUserService: true,
        hasPostService: true,
        hasUserService: true,
        postServiceName: '',
        postServiceType: 'object',
        userServiceName: 'userService',
        userServiceType: 'object',
      })
      const userService = result.importedModules.userService
      expect(await userService.getUserById(5)).toMatchObject({
        id: 5,
        name: 'Test User',
        email: 'test@example.com',
      })
    })

    it('uses cedarSwapApolloProvider to swap ApolloProvider when streaming is enabled', async () => {
      mocks.experimental = {
        streamingSsr: {
          enabled: true,
        },
      }

      const modulePath = path.join(
        fixturesDir,
        'cedar-app',
        'web',
        'src',
        'App.tsx',
      )
      const result = await nodeRunner.importFile(modulePath)
      expect(result).toHaveProperty('default', expect.any(Function))
      const suspenseApolloProvider = result
        .default({})
        .type({})
        .props.children.type.toString()
      expect(suspenseApolloProvider).toContain('serverAuthState')
      expect(suspenseApolloProvider).toContain('ServerAuthContext')
    })
  })
})
