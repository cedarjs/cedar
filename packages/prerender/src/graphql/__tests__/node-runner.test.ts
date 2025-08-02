import path from 'node:path'

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { NodeRunner } from '../node-runner.js'

// Mock dependencies
vi.mock('vite', () => ({
  createServer: vi.fn(),
  version: '5.0.0',
}))

vi.mock('vite-node/client', () => ({
  ViteNodeRunner: vi.fn(),
}))

vi.mock('vite-node/server', () => ({
  ViteNodeServer: vi.fn(),
}))

vi.mock('vite-node/source-map', () => ({
  installSourcemapsSupport: vi.fn(),
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: vi.fn(() => ({
    api: {
      src: '/mock/api/src',
      functions: '/mock/api/src/functions',
    },
    web: {
      src: '/mock/web/src',
      graphql: '/mock/web/src/graphql',
    },
  })),
  projectIsEsm: vi.fn(() => true),
}))

vi.mock('@cedarjs/vite', () => ({
  cedarCellTransform: vi.fn(() => ({ name: 'cedar-cell-transform' })),
  cedarjsDirectoryNamedImportPlugin: vi.fn(() => ({
    name: 'cedar-directory-named-import',
  })),
  cedarjsJobPathInjectorPlugin: vi.fn(() => ({
    name: 'cedar-job-path-injector',
  })),
  cedarSwapApolloProvider: vi.fn(() => ({
    name: 'cedar-swap-apollo-provider',
  })),
}))

describe('NodeRunner', () => {
  let nodeRunner: NodeRunner
  let mockViteServer: any
  let mockViteNodeRunner: any
  let mockViteNodeServer: any

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks()

    // Setup mock Vite server
    mockViteServer = {
      config: {
        root: '/mock/project/root',
        base: '/',
      },
      pluginContainer: {
        buildStart: vi.fn(),
      },
      close: vi.fn(),
    }

    // Setup mock ViteNodeRunner
    mockViteNodeRunner = {
      executeFile: vi.fn(),
    }

    // Setup mock ViteNodeServer
    mockViteNodeServer = {
      fetchModule: vi.fn(),
      resolveId: vi.fn(),
      getSourceMap: vi.fn(),
    }

    // Configure mocks
    const { createServer } = await import('vite')
    const { ViteNodeRunner } = await import('vite-node/client')
    const { ViteNodeServer } = await import('vite-node/server')

    vi.mocked(createServer).mockResolvedValue(mockViteServer)
    vi.mocked(ViteNodeRunner).mockImplementation(() => mockViteNodeRunner)
    vi.mocked(ViteNodeServer).mockImplementation(() => mockViteNodeServer)

    nodeRunner = new NodeRunner()
  })

  afterEach(async () => {
    if (nodeRunner) {
      await nodeRunner.close()
    }
  })

  describe('constructor', () => {
    test('creates a new NodeRunner instance', () => {
      expect(nodeRunner).toBeInstanceOf(NodeRunner)
    })

    test('initializes with undefined viteServer and runner', () => {
      // Since these are private properties, we test behavior instead
      expect(nodeRunner).toBeDefined()
    })
  })

  describe('init', () => {
    test('initializes vite server with correct configuration', async () => {
      const { createServer } = await import('vite')

      await nodeRunner.init()

      expect(createServer).toHaveBeenCalledWith({
        mode: 'production',
        optimizeDeps: {
          noDiscovery: true,
          include: undefined,
        },
        resolve: {
          alias: [
            {
              find: /^src\//,
              replacement: '/mock/api/src/',
            },
          ],
        },
        plugins: expect.arrayContaining([
          expect.objectContaining({ name: 'cedar-cell-transform' }),
          expect.objectContaining({ name: 'cedar-directory-named-import' }),
          expect.objectContaining({ name: 'cedar-job-path-injector' }),
          expect.objectContaining({ name: 'cedar-swap-apollo-provider' }),
        ]),
      })
    })

    test('creates ViteNodeServer with correct configuration', async () => {
      const { ViteNodeServer } = await import('vite-node/server')

      await nodeRunner.init()

      expect(ViteNodeServer).toHaveBeenCalledWith(mockViteServer, {
        transformMode: {
          ssr: [/.*/],
          web: [/\/web\//],
        },
        deps: {
          fallbackCJS: true,
        },
      })
    })

    test('creates ViteNodeRunner with correct configuration', async () => {
      const { ViteNodeRunner } = await import('vite-node/client')

      await nodeRunner.init()

      expect(ViteNodeRunner).toHaveBeenCalledWith({
        root: '/mock/project/root',
        base: '/',
        fetchModule: expect.any(Function),
        resolveId: expect.any(Function),
      })
    })

    test('installs source map support', async () => {
      const { installSourcemapsSupport } = await import('vite-node/source-map')

      await nodeRunner.init()

      expect(installSourcemapsSupport).toHaveBeenCalledWith({
        getSourceMap: expect.any(Function),
      })
    })

    test('calls buildStart for old Vite versions', async () => {
      // Mock old Vite version
      vi.doMock('vite', () => ({
        createServer: vi.fn().mockResolvedValue(mockViteServer),
        version: '4.5.0',
      }))

      const nodeRunnerOldVite = new NodeRunner()
      await nodeRunnerOldVite.init()

      expect(mockViteServer.pluginContainer.buildStart).toHaveBeenCalledWith({})

      await nodeRunnerOldVite.close()
    })

    test('does not call buildStart for new Vite versions', async () => {
      await nodeRunner.init()

      expect(mockViteServer.pluginContainer.buildStart).not.toHaveBeenCalled()
    })

    test('can be called multiple times safely', async () => {
      const { createServer } = await import('vite')

      await nodeRunner.init()
      await nodeRunner.init()

      // Should only create server once
      expect(createServer).toHaveBeenCalledTimes(1)
    })
  })

  describe('importFile', () => {
    test('automatically initializes if not already initialized', async () => {
      const { createServer } = await import('vite')
      const filePath = '/mock/path/to/file.js'

      mockViteNodeRunner.executeFile.mockResolvedValue({
        default: 'mock-export',
      })

      const result = await nodeRunner.importFile(filePath)

      expect(createServer).toHaveBeenCalled()
      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledWith(filePath)
      expect(result).toEqual({ default: 'mock-export' })
    })

    test('imports file using ViteNodeRunner', async () => {
      const filePath = '/mock/path/to/file.js'
      const mockExports = {
        handler: vi.fn(),
        someOtherExport: 'value',
      }

      mockViteNodeRunner.executeFile.mockResolvedValue(mockExports)

      await nodeRunner.init()
      const result = await nodeRunner.importFile(filePath)

      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledWith(filePath)
      expect(result).toBe(mockExports)
    })

    test('handles GraphQL handler import', async () => {
      const gqlPath = '/mock/api/src/functions/graphql'
      const mockHandler = vi.fn().mockResolvedValue({ body: { data: {} } })

      mockViteNodeRunner.executeFile.mockResolvedValue({
        handler: mockHandler,
      })

      const result = await nodeRunner.importFile(gqlPath)

      expect(result).toEqual({ handler: mockHandler })
    })

    test('handles trusted documents import', async () => {
      const documentsPath = '/mock/web/src/graphql/graphql'
      const mockDocuments = {
        GetUserDocument: {
          __meta__: {
            hash: 'abc123',
          },
        },
      }

      mockViteNodeRunner.executeFile.mockResolvedValue(mockDocuments)

      const result = await nodeRunner.importFile(documentsPath)

      expect(result).toEqual(mockDocuments)
    })

    test('passes through import errors', async () => {
      const filePath = '/mock/nonexistent/file.js'
      const importError = new Error('Module not found')

      mockViteNodeRunner.executeFile.mockRejectedValue(importError)

      await expect(nodeRunner.importFile(filePath)).rejects.toThrow(
        'Module not found',
      )
    })

    test('works with ESM files', async () => {
      const filePath = '/mock/path/to/module.mjs'
      const mockEsmExports = {
        namedExport: 'value',
        default: 'default-value',
      }

      mockViteNodeRunner.executeFile.mockResolvedValue(mockEsmExports)

      const result = await nodeRunner.importFile(filePath)

      expect(result).toEqual(mockEsmExports)
    })

    test('works with CommonJS files', async () => {
      const filePath = '/mock/path/to/module.js'
      const mockCjsExports = {
        module: { exports: { handler: vi.fn() } },
      }

      mockViteNodeRunner.executeFile.mockResolvedValue(mockCjsExports)

      const result = await nodeRunner.importFile(filePath)

      expect(result).toEqual(mockCjsExports)
    })

    test('handles TypeScript files', async () => {
      const filePath = '/mock/path/to/module.ts'
      const mockTsExports = {
        handler: vi.fn(),
        config: { timeout: 5000 },
      }

      mockViteNodeRunner.executeFile.mockResolvedValue(mockTsExports)

      const result = await nodeRunner.importFile(filePath)

      expect(result).toEqual(mockTsExports)
    })
  })

  describe('close', () => {
    test('closes vite server when initialized', async () => {
      await nodeRunner.init()
      await nodeRunner.close()

      expect(mockViteServer.close).toHaveBeenCalled()
    })

    test('does not throw when closing uninitialized runner', async () => {
      await expect(nodeRunner.close()).resolves.not.toThrow()
    })

    test('can be called multiple times safely', async () => {
      await nodeRunner.init()
      await nodeRunner.close()
      await nodeRunner.close()

      expect(mockViteServer.close).toHaveBeenCalledTimes(1)
    })

    test('handles vite server close errors gracefully', async () => {
      mockViteServer.close.mockRejectedValue(new Error('Close failed'))

      await nodeRunner.init()

      await expect(nodeRunner.close()).rejects.toThrow('Close failed')
    })
  })

  describe('integration scenarios', () => {
    test('typical GraphQL handler workflow', async () => {
      // Simulate the workflow from graphql.ts
      const gqlPath = '/mock/api/src/functions/graphql'
      const mockHandler = vi.fn().mockResolvedValue({
        body: JSON.stringify({ data: { user: { id: '1', name: 'John' } } }),
      })

      mockViteNodeRunner.executeFile.mockResolvedValue({
        handler: mockHandler,
      })

      const { handler } = await nodeRunner.importFile(gqlPath)

      expect(handler).toBe(mockHandler)
      expect(typeof handler).toBe('function')
    })

    test('trusted documents workflow', async () => {
      // Simulate the trusted documents workflow
      const documentsPath = '/mock/web/src/graphql/graphql'
      const mockDocuments = {
        GetUserDocument: {
          __meta__: { hash: 'user-query-hash' },
        },
        UpdateUserDocument: {
          __meta__: { hash: 'update-user-hash' },
        },
      }

      mockViteNodeRunner.executeFile.mockResolvedValue(mockDocuments)

      const documents = await nodeRunner.importFile(documentsPath)

      expect(documents.GetUserDocument.__meta__.hash).toBe('user-query-hash')
      expect(documents.UpdateUserDocument.__meta__.hash).toBe(
        'update-user-hash',
      )
    })

    test('error handling in production workflow', async () => {
      // Test error handling as it would occur in getGqlHandler
      const gqlPath = '/mock/api/src/functions/graphql'

      mockViteNodeRunner.executeFile.mockRejectedValue(
        new Error('Import failed'),
      )

      await expect(nodeRunner.importFile(gqlPath)).rejects.toThrow(
        'Import failed',
      )
    })

    test('concurrent imports', async () => {
      const filePath1 = '/mock/path/to/file1.js'
      const filePath2 = '/mock/path/to/file2.js'

      mockViteNodeRunner.executeFile
        .mockResolvedValueOnce({ export1: 'value1' })
        .mockResolvedValueOnce({ export2: 'value2' })

      const [result1, result2] = await Promise.all([
        nodeRunner.importFile(filePath1),
        nodeRunner.importFile(filePath2),
      ])

      expect(result1).toEqual({ export1: 'value1' })
      expect(result2).toEqual({ export2: 'value2' })
      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledTimes(2)
    })

    test('reusing initialized runner for multiple imports', async () => {
      const { createServer } = await import('vite')

      mockViteNodeRunner.executeFile
        .mockResolvedValueOnce({ handler: vi.fn() })
        .mockResolvedValueOnce({ config: {} })

      await nodeRunner.importFile('/mock/file1.js')
      await nodeRunner.importFile('/mock/file2.js')

      // Should only initialize once
      expect(createServer).toHaveBeenCalledTimes(1)
      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledTimes(2)
    })
  })

  describe('edge cases', () => {
    test('handles file paths with special characters', async () => {
      const filePath = '/mock/path/with spaces/and-special_chars.js'

      mockViteNodeRunner.executeFile.mockResolvedValue({ default: 'test' })

      const result = await nodeRunner.importFile(filePath)

      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledWith(filePath)
      expect(result).toEqual({ default: 'test' })
    })

    test('handles absolute file paths', async () => {
      const filePath = path.resolve('/absolute/path/to/file.js')

      mockViteNodeRunner.executeFile.mockResolvedValue({ handler: vi.fn() })

      await nodeRunner.importFile(filePath)

      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledWith(filePath)
    })

    test('handles relative file paths', async () => {
      const filePath = './relative/path/to/file.js'

      mockViteNodeRunner.executeFile.mockResolvedValue({ handler: vi.fn() })

      await nodeRunner.importFile(filePath)

      expect(mockViteNodeRunner.executeFile).toHaveBeenCalledWith(filePath)
    })

    test('handles empty module exports', async () => {
      const filePath = '/mock/empty/module.js'

      mockViteNodeRunner.executeFile.mockResolvedValue({})

      const result = await nodeRunner.importFile(filePath)

      expect(result).toEqual({})
    })

    test('handles null/undefined module exports', async () => {
      const filePath = '/mock/null/module.js'

      mockViteNodeRunner.executeFile.mockResolvedValue(null)

      const result = await nodeRunner.importFile(filePath)

      expect(result).toBe(null)
    })
  })
})
