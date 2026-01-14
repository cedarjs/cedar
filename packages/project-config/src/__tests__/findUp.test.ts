import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { findUp } from '../findUp'

vi.mock('node:fs')

describe('findUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finds a single file in the current directory', () => {
    const fileName = 'cedar.toml'
    const currentDir = '/project/app'
    const expectedPath = path.join(currentDir, fileName)

    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = findUp(fileName, currentDir)
    expect(result).toBe(expectedPath)
  })

  it('finds a file in a parent directory', () => {
    const fileName = 'cedar.toml'
    const currentDir = '/project/app/src'
    const expectedPath = path.join('/project', 'cedar.toml')

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === expectedPath
    })

    const result = findUp(fileName, currentDir)
    expect(result).toBe(expectedPath)
  })

  it('finds the first matching file from an array in the current directory', () => {
    const fileNames = ['cedar.toml', 'redwood.toml']
    const currentDir = '/project/app'
    const expectedPath = path.join(currentDir, 'cedar.toml')

    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = findUp(fileNames, currentDir)
    expect(result).toBe(expectedPath)
  })

  it('prioritizes files in the array order', () => {
    const fileNames = ['cedar.toml', 'redwood.toml']
    const currentDir = '/project/app'

    // Both exist
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (
        p === path.join(currentDir, 'cedar.toml') ||
        p === path.join(currentDir, 'redwood.toml')
      )
    })

    const result = findUp(fileNames, currentDir)
    expect(result).toBe(path.join(currentDir, 'cedar.toml'))
  })

  it('finds a fallback file in a parent directory', () => {
    const fileNames = ['cedar.toml', 'redwood.toml']
    const currentDir = '/project/app/src'
    const expectedPath = path.join('/project', 'redwood.toml')

    vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedPath)

    const result = findUp(fileNames, currentDir)
    expect(result).toBe(expectedPath)
  })

  it('returns null if no files are found', () => {
    const fileNames = ['cedar.toml', 'redwood.toml']
    const currentDir = '/project/app'

    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = findUp(fileNames, currentDir)
    expect(result).toBe(null)
  })
})
