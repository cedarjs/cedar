import { describe, it, expect, vi } from 'vitest'

import { getConfig } from '@cedarjs/project-config'

import { getPackageManager } from '../config.js'

vi.mock('@cedarjs/project-config', () => ({
  getConfig: vi.fn(),
}))

describe('getPackageManager', () => {
  it('returns specified package manager', () => {
    vi.mocked(getConfig).mockReturnValue({ packageManager: 'npm' } as any)
    expect(getPackageManager()).toBe('npm')
  })

  it('falls back to yarn if not specified', () => {
    vi.mocked(getConfig).mockReturnValue({} as any)
    expect(getPackageManager()).toBe('yarn')
  })

  it('falls back to yarn on error', () => {
    vi.mocked(getConfig).mockImplementation(() => {
      throw new Error('boom')
    })
    expect(getPackageManager()).toBe('yarn')
  })
})
