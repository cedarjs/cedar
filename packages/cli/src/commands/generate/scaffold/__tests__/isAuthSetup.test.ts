globalThis.__dirname = import.meta.dirname

import type * as NodeFs from 'node:fs'

import { vol, fs as memfs } from 'memfs'
import { ufs } from 'unionfs'
import { vi, describe, beforeEach, test, expect } from 'vitest'

import '../../../../lib/test'

import { isAuthSetup } from '../scaffoldHandler.js'

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../../../__tests__/ufsFsProxy.js')
  const fs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(fs)).use(wrapMemfsForUnionfs(memfs))
  return { ...ufs, default: { ...ufs } }
})
vi.mock('execa')

describe('isAuthSetup', () => {
  beforeEach(() => {
    vol.reset()
    vol.fromJSON({ 'redwood.toml': '' }, '/')
  })

  test('returns false when web/src/auth.{ts,js,tsx,jsx} does not exist', () => {
    expect(isAuthSetup()).toBe(false)
  })

  test('returns true when web/src/auth.ts exists', () => {
    vol.fromJSON(
      { 'web/src/auth.ts': "export const { AuthProvider } = createAuth()" },
      '/path/to/project',
    )

    expect(isAuthSetup()).toBe(true)
  })

  test('returns true when web/src/auth.tsx exists', () => {
    vol.fromJSON(
      { 'web/src/auth.tsx': "export const { AuthProvider } = createAuth()" },
      '/path/to/project',
    )

    expect(isAuthSetup()).toBe(true)
  })

  test('returns false when an unrelated web/src file exists', () => {
    vol.fromJSON(
      { 'web/src/App.tsx': 'export default App' },
      '/path/to/project',
    )

    expect(isAuthSetup()).toBe(false)
  })
})
