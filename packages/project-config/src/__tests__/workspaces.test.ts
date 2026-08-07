import { vol } from 'memfs'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import { getNonApiWebWorkspaces } from '../workspaces.js'

vi.mock('node:fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs, default: memfs.fs }
})

vi.mock('../packageManager', () => ({
  getPackageManager: vi.fn(() => 'pnpm'),
}))

const origCedarCwd = process.env.CEDAR_CWD

beforeEach(() => {
  vol.reset()
  process.env.CEDAR_CWD = '/test-project'
})

afterEach(() => {
  process.env.CEDAR_CWD = origCedarCwd
})

describe('getNonApiWebWorkspaces with pnpm', () => {
  it('parses workspace dirs from a multi-key pnpm-workspace.yaml', () => {
    vol.fromJSON(
      {
        'pnpm-workspace.yaml': [
          'packages:',
          '  - api',
          '  - web',
          '  - packages/validators',
          '',
          'allowBuilds:',
          '  esbuild: true',
          '',
          'overrides:',
          "  'react-is': '19.2.3'",
        ].join('\n'),
      },
      '/test-project',
    )

    const result = getNonApiWebWorkspaces('/test-project')

    // api and web are filtered out by getNonApiWebWorkspaces
    expect(result).toEqual(['packages/validators'])
  })
})
