import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Need to use dynamic imports because config paths are cached
// import { getConfigPath } from '../configPath'

vi.mock('node:fs')

describe('getConfigPath', () => {
  const originalEnv = process.env.CEDAR_CWD

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CEDAR_CWD
    // We need to clear the cache in configPath.ts, but it's not exported.
    // Since it's a module-level variable, we reset vitest's module cache to
    // force a fresh import of configPath.ts
    vi.resetModules()
  })

  afterEach(() => {
    process.env.CEDAR_CWD = originalEnv
  })

  it('finds cedar.toml if it exists', async () => {
    const { getConfigPath } = await import('../configPath.js')
    const currentDir = '/project/app'
    const expectedPath = path.join(currentDir, 'cedar.toml')

    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = getConfigPath(currentDir)
    expect(result).toBe(expectedPath)
  })

  it('finds redwood.toml if cedar.toml does not exist', async () => {
    const { getConfigPath } = await import('../configPath.js')
    const currentDir = '/project/app'
    const expectedPath = path.join(currentDir, 'redwood.toml')

    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = getConfigPath(currentDir)
    expect(result).toBe(expectedPath)
  })

  it('prioritizes cedar.toml over redwood.toml', async () => {
    const { getConfigPath } = await import('../configPath.js')
    const currentDir = '/project/app'
    const cedarPath = path.join(currentDir, 'cedar.toml')
    const redwoodPath = path.join(currentDir, 'redwood.toml')

    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === cedarPath || p === redwoodPath,
    )

    const result = getConfigPath(currentDir)
    expect(result).toBe(cedarPath)
  })

  it('throws an error if neither exists', async () => {
    const { getConfigPath } = await import('../configPath.js')
    const currentDir = '/project/app'

    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(() => getConfigPath(currentDir)).toThrow(
      /Could not find a "cedar.toml" or "redwood.toml" file/,
    )
  })
})
