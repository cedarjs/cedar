import { fs as memfs, vol } from 'memfs'
import { describe, afterEach, it, expect, vi } from 'vitest'

import { getTsConfigs } from '../project.js'

vi.mock('fs', async () => ({ ...memfs, default: memfs }))
vi.mock('node:fs', async () => ({ ...memfs, default: memfs }))

afterEach(() => {
  vol.reset()
})

describe('Retrieves TSConfig settings', () => {
  it('Gets config for a TS Project', () => {
    vol.fromNestedJSON(
      {
        'api/tsconfig.json': JSON.stringify({
          compilerOptions: {
            rootDirs: ['./src', '../.redwood/types/mirror/api/src'],
          },
        }),
        'web/tsconfig.json': JSON.stringify({
          compilerOptions: {
            noEmit: true,
          },
        }),
        'redwood.toml': '',
      },
      '/',
    )

    const tsConfiguration = getTsConfigs()

    expect(tsConfiguration.web).not.toBe(null)
    expect(tsConfiguration.api).not.toBe(null)

    // Check some of the values
    expect(tsConfiguration.web.compilerOptions.noEmit).toBe(true)
    expect(tsConfiguration.api.compilerOptions.rootDirs).toEqual([
      './src',
      '../.redwood/types/mirror/api/src',
    ])
  })

  it('Returns null for JS projects', () => {
    vol.fromNestedJSON({ 'redwood.toml': '' }, '/')

    const tsConfiguration = getTsConfigs()

    expect(tsConfiguration.web).toBe(null)
    expect(tsConfiguration.api).toBe(null)
  })
})
