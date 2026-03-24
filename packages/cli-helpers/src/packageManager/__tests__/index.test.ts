import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

import { workspacePackageVersion } from '../index.js'

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
    expect(workspacePackageVersion()).toBe('workspace:*')
  })

  it('returns the version string to use for npm workspace packages', () => {
    vi.mocked(getPackageManager).mockReturnValue('npm')
    expect(workspacePackageVersion()).toBe('*')
  })
})
