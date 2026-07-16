import path from 'node:path'

import { vol } from 'memfs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { cedarDirectoryNamedImportPlugin } from '../vite-plugin-cedar-directory-named-import.js'

vi.mock('node:fs', async () => ({ default: (await import('memfs')).fs }))

// The fixture project root used across all tests
const PROJECT_ROOT = '/test/project'

// The file doing the importing (importer context)
const IMPORTER = path.join(PROJECT_ROOT, 'src/SomeComponent.tsx')

function getPluginResolveId() {
  const plugin = cedarDirectoryNamedImportPlugin()

  if (typeof plugin.resolveId !== 'function') {
    throw new Error('Expected plugin to have a resolveId function')
  }

  return plugin.resolveId.bind(
    {} as ThisParameterType<typeof plugin.resolveId>,
  )
}

describe('cedarDirectoryNamedImportPlugin', () => {
  beforeEach(() => {
    // Set up the virtual filesystem for each test
    vol.fromJSON(
      {
        // Directory-named module (.tsx)
        'src/components/Button/Button.tsx': 'export const Button = () => null',
        // Directory-named module (.ts)
        'src/components/Icon/Icon.ts': 'export const Icon = () => null',
        // Directory-named module (.jsx)
        'src/components/Logo/Logo.jsx': 'export const Logo = () => null',
        // Directory-named module (.js)
        'src/components/Widget/Widget.js': 'export const Widget = () => null',
        // Index file wins when present
        'src/components/Card/index.ts': 'export const Card = () => null',
        // Both index and directory-named exist — index should win
        'src/components/Alert/index.ts': 'export const Alert = () => null',
        'src/components/Alert/Alert.tsx': 'export const Alert = () => null',
        // Direct file (not a directory) — plugin should leave it alone
        'src/pages/Home.tsx': 'export default function Home() {}',
        // The importer itself
        'src/SomeComponent.tsx': '',
      },
      PROJECT_ROOT,
    )
  })

  afterEach(() => {
    vol.reset()
  })

  it('resolves directory-named .tsx module', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Button', IMPORTER)
    expect(result).toBe(
      path.join(PROJECT_ROOT, 'src/components/Button/Button.tsx'),
    )
  })

  it('resolves directory-named .ts module', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Icon', IMPORTER)
    expect(result).toBe(
      path.join(PROJECT_ROOT, 'src/components/Icon/Icon.ts'),
    )
  })

  it('resolves directory-named .jsx module', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Logo', IMPORTER)
    expect(result).toBe(
      path.join(PROJECT_ROOT, 'src/components/Logo/Logo.jsx'),
    )
  })

  it('resolves directory-named .js module', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Widget', IMPORTER)
    expect(result).toBe(
      path.join(PROJECT_ROOT, 'src/components/Widget/Widget.js'),
    )
  })

  it('prefers index file over directory-named module', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Card', IMPORTER)
    expect(result).toBe(
      path.join(PROJECT_ROOT, 'src/components/Card/index.ts'),
    )
  })

  it('prefers index file when both index and directory-named exist', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Alert', IMPORTER)
    expect(result).toBe(
      path.join(PROJECT_ROOT, 'src/components/Alert/index.ts'),
    )
  })

  it('returns null for imports that resolve directly as files', () => {
    const resolveId = getPluginResolveId()
    // Home.tsx exists directly — let Vite handle it
    const result = resolveId('./pages/Home', IMPORTER)
    expect(result).toBeNull()
  })

  it('returns null for imports that cannot be resolved at all', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/NonExistent', IMPORTER)
    expect(result).toBeNull()
  })

  it('returns null for non-relative imports (npm packages)', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('react', IMPORTER)
    expect(result).toBeNull()
  })

  it('returns null when there is no importer', () => {
    const resolveId = getPluginResolveId()
    const result = resolveId('./components/Button', undefined)
    expect(result).toBeNull()
  })

  it('returns null for imports from node_modules', () => {
    const resolveId = getPluginResolveId()
    const nodeModulesImporter = path.join(
      PROJECT_ROOT,
      'node_modules/some-lib/index.js',
    )
    const result = resolveId('./Button', nodeModulesImporter)
    expect(result).toBeNull()
  })
})
