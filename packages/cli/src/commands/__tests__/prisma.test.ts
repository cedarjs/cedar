import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

import { vi, beforeEach, afterEach, test, expect } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: () => 'yarn',
}))

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()
  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        api: {
          prismaConfig:
            '/Users/bazinga/My Projects/rwprj/rwprj/api/prisma.config.js',
        },
        base: '/Users/bazinga/My Projects/rwprj/rwprj',
      }
    },
  }
})

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn((cmd, params, options) => {
    return {
      cmd,
      params,
      options,
      status: 0,
    }
  }),
}))

import { handler } from '../prisma.js'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
})

afterEach(() => {
  vi.mocked(console).info.mockRestore()
  vi.mocked(console).log.mockRestore()
})

test('the prisma command handles spaces', async () => {
  await handler({
    _: ['prisma'],
    $0: 'cedar',
    commands: ['migrate', 'dev'],
    // options
    n: 'add bazingas',
  })

  expect(vi.mocked(spawnSync).mock.calls[0][1]).toEqual([
    'prisma',
    'migrate',
    'dev',
    '-n',
    '"add bazingas"',
    '--config',
    '"/Users/bazinga/My Projects/rwprj/rwprj/api/prisma.config.js"',
  ])
})
