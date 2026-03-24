import fs from 'node:fs'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getPackageManager,
  prettyPrintCedarCommand,
  resetPackageManagerCache,
} from '../packageManager.js'

vi.mock('../paths.js', () => ({
  getPaths: () => ({
    base: '/cedar-app',
  }),
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}))

beforeEach(() => {
  resetPackageManagerCache()
  vi.resetAllMocks()
})

describe('getPackageManager', () => {
  it('prefers yarn when multiple lock files are present', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      if (filePath.toString().endsWith('pnpm-lock.yaml')) {
        return true
      } else if (filePath.toString().endsWith('package-lock.json')) {
        return true
      } else if (filePath.toString().endsWith('yarn.lock')) {
        return true
      }

      return false
    })

    expect(getPackageManager()).toBe('yarn')
  })

  it('uses pnpm when pnpm-lock.yaml is present', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      return filePath.toString().endsWith('pnpm-lock.yaml')
    })

    expect(getPackageManager()).toBe('pnpm')
  })

  it('falls back to yarn if no lock files are present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(getPackageManager()).toBe('yarn')
  })
})

describe('prettyPrintCedarCommand', () => {
  it('returns the command to use for yarn', () => {
    expect(prettyPrintCedarCommand(['info'])).toBe('yarn cedar info')
  })

  it('returns the command to use for npm', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      return filePath.toString().endsWith('package-lock.json')
    })
    expect(prettyPrintCedarCommand(['generate', 'page', 'home'])).toBe(
      'npx cedar generate page home',
    )
  })
})
