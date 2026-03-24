import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { workspacePackageSpecifier } from '../index.js'

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    base: '/cedar-app',
  }),
}))

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('worspacePackageVersion', () => {
  it('returns the version string to use for yarn workspace packages', () => {
    expect(workspacePackageSpecifier()).toBe('workspace:*')
  })

  it('returns the version string to use for npm workspace packages', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(workspacePackageSpecifier()).toBe('*')
  })
})
