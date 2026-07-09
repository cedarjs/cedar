import path from 'node:path'

import { vol } from 'memfs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizePath } from 'vite'

import { cedarDirectoryNamedImportPlugin } from '../vite-plugin-cedar-directory-named-import.js'

vi.mock('node:fs', async () => ({ default: (await import('memfs')).fs }))

// Use a cross-platform absolute path: on Windows path.resolve adds the current
// drive letter (e.g. 'C:/Users/test/app'), matching what Vite passes to resolveId.
const APP_DIR = normalizePath(path.resolve('/', 'Users', 'test', 'app'))
const SRC_DIR = `${APP_DIR}/web/src`

function getResolveId() {
  const plugin = cedarDirectoryNamedImportPlugin()
  if (typeof plugin.resolveId !== 'function') {
    throw new Error('Expected plugin to have a resolveId function')
  }
  return plugin.resolveId.bind({} as ThisParameterType<typeof plugin.resolveId>)
}

beforeEach(() => {
  vol.reset()
})

afterEach(() => {
  vol.reset()
})

describe('cedarDirectoryNamedImportPlugin', () => {
  it('resolves a directory-named module (Module/Module.ts)', () => {
    vol.fromJSON({
      [`${SRC_DIR}/components/Module/Module.ts`]: 'export const Module = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId('./components/Module', `${SRC_DIR}/App.tsx`, {})

    expect(result).toBe(`${SRC_DIR}/components/Module/Module.ts`)
  })

  it('resolves a directory-named TSX module (TSX/TSX.tsx)', () => {
    vol.fromJSON({
      [`${SRC_DIR}/components/TSX/TSX.tsx`]: 'export const TSX = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId('./components/TSX', `${SRC_DIR}/App.tsx`, {})

    expect(result).toBe(`${SRC_DIR}/components/TSX/TSX.tsx`)
  })

  it('prefers index file over directory-named module', () => {
    vol.fromJSON({
      [`${SRC_DIR}/components/indexModule/index.ts`]: 'export const index = 1',
      [`${SRC_DIR}/components/indexModule/indexModule.ts`]:
        'export const indexModule = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId(
      './components/indexModule',
      `${SRC_DIR}/App.tsx`,
      {},
    )

    // index.ts should be preferred
    expect(result).toBe(`${SRC_DIR}/components/indexModule/index.ts`)
  })

  it('resolves index-only directory', () => {
    vol.fromJSON({
      [`${SRC_DIR}/components/MyComp/index.tsx`]: 'export const MyComp = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId('./components/MyComp', `${SRC_DIR}/App.tsx`, {})

    expect(result).toBe(`${SRC_DIR}/components/MyComp/index.tsx`)
  })

  it('resolves a JSX directory-named module', () => {
    vol.fromJSON({
      [`${SRC_DIR}/components/JSX/JSX.jsx`]: 'export const JSX = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId('./components/JSX', `${SRC_DIR}/App.tsx`, {})

    expect(result).toBe(`${SRC_DIR}/components/JSX/JSX.jsx`)
  })

  it('returns null when the import resolves directly', () => {
    vol.fromJSON({
      [`${SRC_DIR}/components/Button.tsx`]: 'export const Button = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId('./components/Button', `${SRC_DIR}/App.tsx`, {})

    // Button.tsx exists directly, so no rewrite needed
    expect(result).toBeNull()
  })

  it('returns null for non-relative imports', () => {
    const resolveId = getResolveId()
    const result = resolveId('react', `${SRC_DIR}/App.tsx`, {})

    expect(result).toBeNull()
  })

  it('returns null when no importer is provided', () => {
    const resolveId = getResolveId()
    const result = resolveId('./SomeComponent', undefined, {})

    expect(result).toBeNull()
  })

  it('returns null for imports from node_modules', () => {
    vol.fromJSON({
      [`${APP_DIR}/node_modules/my-pkg/Component/Component.ts`]:
        'export const Component = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId(
      './Component',
      `${APP_DIR}/node_modules/my-pkg/index.ts`,
      {},
    )

    // Importer is in node_modules, should skip
    expect(result).toBeNull()
  })

  it('returns null when no directory-named file or index is found', () => {
    vol.fromJSON({})

    const resolveId = getResolveId()
    const result = resolveId('./components/Missing', `${SRC_DIR}/App.tsx`, {})

    expect(result).toBeNull()
  })

  it('handles nested relative paths (../)', () => {
    vol.fromJSON({
      [`${SRC_DIR}/shared/Button/Button.ts`]: 'export const Button = 1',
    })

    const resolveId = getResolveId()
    const result = resolveId(
      '../shared/Button',
      `${SRC_DIR}/components/File.tsx`,
      {},
    )

    expect(result).toBe(`${SRC_DIR}/shared/Button/Button.ts`)
  })
})
