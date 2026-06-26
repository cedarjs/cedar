import fs from 'node:fs'
import path from 'node:path'

import { vol } from 'memfs'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { addWorkspaceDir } from '../workspaces.js'

vi.mock('node:fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs, default: memfs.fs }
})

beforeEach(() => {
  vol.reset()
})

describe('addWorkspaceDir with pnpm', () => {
  it('adds a workspace entry into a multi-key pnpm-workspace.yaml', () => {
    vol.fromJSON(
      {
        'pnpm-workspace.yaml': [
          'packages:',
          '  - api',
          '  - web',
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

    const result = addWorkspaceDir(
      '/test-project',
      'packages/validators',
      'pnpm',
    )

    expect(result).toBe('added')

    const updated = fs.readFileSync(
      path.join('/test-project', 'pnpm-workspace.yaml'),
      'utf8',
    )
    expect(updated).toMatchInlineSnapshot(`
      "packages:
        - api
        - web
        - packages/validators

      allowBuilds:
        esbuild: true

      overrides:
        'react-is': '19.2.3'"
    `)
  })
})
