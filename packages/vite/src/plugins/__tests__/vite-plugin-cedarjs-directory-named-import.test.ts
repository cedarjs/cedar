import path from 'node:path'

import { vol } from 'memfs'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { cedarjsDirectoryNamedImportPlugin } from '../vite-plugin-cedarjs-directory-named-import.js'

// Mock the filesystem to use memfs for testing
// This allows us to create a virtual filesystem without touching the real one
vi.mock('node:fs', async () => {
  const memfs = await vi.importActual('memfs')
  return {
    default: {
      existsSync: memfs.existsSync,
      statSync: memfs.statSync,
    },
    ...memfs,
  }
})

vi.mock('node:fs/promises', async () => {
  const memfs = await vi.importActual('memfs')
  return {
    ...memfs,
    default: memfs,
  }
})

// Mock the resolveFile function from project-config to work with our virtual filesystem
vi.mock('@cedarjs/project-config', async () => {
  const actual = await vi.importActual('@cedarjs/project-config')
  const { vol } = await vi.importActual('memfs')
  return {
    ...actual,
    resolveFile: (
      filePath: string,
      extensions: string[] = ['.js', '.tsx', '.ts', '.jsx', '.mjs', '.mts'],
    ) => {
      for (const extension of extensions) {
        const p = `${filePath}${extension}`
        if (vol.existsSync(p)) {
          return p
        }
      }
      return null
    },
  }
})

const testCases = [
  {
    description: 'Should resolve directory named imports for .js files',
    input: './__fixtures__/directory-named-imports/Module',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/Module/Module.js',
    ),
  },
  {
    description: 'Should resolve directory named imports for .tsx files',
    input: './__fixtures__/directory-named-imports/TSX',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/TSX/TSX.tsx',
    ),
  },
  {
    description: 'Should prefer index.js over directory-named files',
    input: './__fixtures__/directory-named-imports/indexModule',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/indexModule/index.js',
    ),
  },
  {
    description: 'Should prefer index.ts over directory-named files',
    input: './__fixtures__/directory-named-imports/TSWithIndex',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/TSWithIndex/index.ts',
    ),
  },
  {
    description: 'Should resolve directory named imports for .ts files',
    input: './__fixtures__/directory-named-imports/TS',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/TS/TS.ts',
    ),
  },
  {
    description:
      'Should resolve directory named imports for .tsx files (duplicate test)',
    input: './__fixtures__/directory-named-imports/TSX',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/TSX/TSX.tsx',
    ),
  },
  {
    description: 'Should resolve directory named imports for .jsx files',
    input: './__fixtures__/directory-named-imports/JSX',
    expected: path.resolve(
      '/src/__fixtures__/directory-named-imports/JSX/JSX.jsx',
    ),
  },
]

describe('directory named imports', () => {
  beforeEach(() => {
    vol.reset()

    // Set up virtual filesystem with test files that match the expected structure
    vol.fromJSON({
      '/src/test.js': 'export default "test"',
      '/src/__fixtures__/directory-named-imports/Module/Module.js':
        'export const ImpModule = "test"; export const ExpModule = "test"',
      '/src/__fixtures__/directory-named-imports/TSX/TSX.tsx':
        'export const ImpTSX = "test"; export const pew = "test"',
      '/src/__fixtures__/directory-named-imports/indexModule/index.js':
        'export const ExpIndex = "test"',
      '/src/__fixtures__/directory-named-imports/TSWithIndex/index.ts':
        'export const TSWithIndex = "test"',
      '/src/__fixtures__/directory-named-imports/TS/TS.ts':
        'export const pew = "test"',
      '/src/__fixtures__/directory-named-imports/JSX/JSX.jsx':
        'export const pew = "test"',
    })
  })

  afterEach(() => {
    vol.reset()
  })

  testCases.forEach(({ description, input, expected }) => {
    it(description, async () => {
      const plugin = cedarjsDirectoryNamedImportPlugin()
      const importer = '/src/test.js'

      const result = await plugin.resolveId?.(input, importer)

      expect(result).toBe(expected)
    })
  })

  describe('edge cases', () => {
    it('should return null for existing files (plugin should not interfere)', async () => {
      const plugin = cedarjsDirectoryNamedImportPlugin()
      const importer = '/src/test.js'

      // Test with an existing file - plugin should not interfere
      vol.fromJSON({
        '/src/existing-file.js': 'export default "test"',
      })

      const result = await plugin.resolveId?.('./existing-file.js', importer)

      expect(result).toBeNull()
    })

    it('should return null when no importer is provided', async () => {
      const plugin = cedarjsDirectoryNamedImportPlugin()

      const result = await plugin.resolveId?.('./some-module')

      expect(result).toBeNull()
    })

    it('should return null for node_modules imports', async () => {
      const plugin = cedarjsDirectoryNamedImportPlugin()
      const importer = '/src/node_modules/some-package/index.js'

      const result = await plugin.resolveId?.('./some-module', importer)

      expect(result).toBeNull()
    })

    it('should return null when no matching directory structure is found', async () => {
      const plugin = cedarjsDirectoryNamedImportPlugin()
      const importer = '/src/test.js'

      const result = await plugin.resolveId?.('./non-existent-module', importer)

      expect(result).toBeNull()
    })
  })
})
