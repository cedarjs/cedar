import fs from 'node:fs'

import execa from 'execa'
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

vi.mock('execa', () => ({
  default: {
    sync: vi.fn((cmd, params, options) => ({
      cmd,
      params,
      options,
    })),
  },
}))

import { handler } from '../prisma.js'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  vi.mocked(execa.sync).mockClear()
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

  // Values must arrive unquoted: the args are passed to execa as an array
  // without a shell, so each value is a single argv entry as-is. Quotes
  // would become part of the value prisma receives.
  expect(vi.mocked(execa.sync).mock.calls[0][1]).toEqual([
    'prisma',
    'migrate',
    'dev',
    '-n',
    'add bazingas',
    '--config',
    '/Users/bazinga/My Projects/rwprj/rwprj/api/prisma.config.js',
  ])

  // The informational output is a plain, space-joined rendering of the same
  // args (matching every other formatXxx display helper, none of which
  // quote or escape their args either).
  const loggedCommand = vi
    .mocked(console.log)
    .mock.calls.flat()
    .find((line) => String(line).includes('prisma migrate dev'))
  expect(loggedCommand).toContain('-n add bazingas')
  expect(loggedCommand).toContain(
    '--config /Users/bazinga/My Projects/rwprj/rwprj/api/prisma.config.js',
  )
})

test('the prisma command does not inherit stdin', async () => {
  await handler({
    _: ['prisma'],
    $0: 'cedar',
    commands: ['migrate', 'dev'],
  })

  // stdin must not be inherited from the parent process: if it were, a
  // non-interactive invocation (CI, piped output, backgrounded) could still
  // present as a TTY to Prisma, causing it to render an interactive prompt
  // that can never be answered and hangs forever instead of failing fast.
  // stdout/stderr are still inherited so Prisma's normal output/formatting
  // reaches the user.
  const options = vi.mocked(execa.sync).mock.calls[0][2]
  expect(options?.stdio).toEqual(['pipe', 'inherit', 'inherit'])
})
