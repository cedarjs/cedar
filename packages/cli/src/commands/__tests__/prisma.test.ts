import fs from 'node:fs'

import execa from 'execa'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

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

vi.mock('execa', () => ({
  default: {
    sync: vi.fn((cmd, params, options) => {
      return {
        cmd,
        params,
        options,
      }
    }),
  },
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
    $0: 'rw',
    commands: ['migrate', 'dev'],
    // options
    n: 'add bazingas',
  })

  expect(vi.mocked(execa.sync).mock.calls[0][1]).toEqual([
    'migrate',
    'dev',
    '-n',
    '"add bazingas"',
    '--config',
    '"/Users/bazinga/My Projects/rwprj/rwprj/api/prisma.config.js"',
  ])
})
