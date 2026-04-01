import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getGeneratedDataDirPath } from '../generatedDataDir.js'

vi.mock('node:fs')

describe('getGeneratedDirPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CEDAR_CWD
    vi.resetModules()
  })

  it('finds .cedar if it exists', async () => {
    const currentDir = '/project/app'
    const expectedPath = path.join(currentDir, '.cedar')

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p).endsWith('.toml')) {
        return true
      }

      return p === expectedPath
    })

    expect(getGeneratedDataDirPath(currentDir)).toBe(expectedPath)
  })

  it('finds .redwood if .cedar does not exist', async () => {
    const currentDir = '/project/app'
    const expectedPath = path.join(currentDir, '.redwood')

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p).endsWith('.toml')) {
        return true
      }

      return p === expectedPath
    })

    expect(getGeneratedDataDirPath(currentDir)).toBe(expectedPath)
  })

  it('prioritizes .cedar over .redwood', async () => {
    const currentDir = '/project/app'
    const cedarPath = path.join(currentDir, '.cedar')
    const redwoodPath = path.join(currentDir, '.redwood')

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p).endsWith('.toml')) {
        return true
      }

      // Both .cedar and .redwood exist
      return p === cedarPath || p === redwoodPath
    })

    expect(getGeneratedDataDirPath(currentDir)).toBe(cedarPath)
  })

  it('defaults to .cedar when neither generated dir exists yet', async () => {
    const currentDir = '/project/app'
    const configPath = path.join(currentDir, 'cedar.toml')

    vi.mocked(fs.existsSync).mockImplementation((p) => p === configPath)

    expect(getGeneratedDataDirPath(currentDir)).toBe(
      path.join(currentDir, '.cedar'),
    )
  })
})
