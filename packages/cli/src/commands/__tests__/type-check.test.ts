import path from 'node:path'

import concurrently from 'concurrently'
import execa from 'execa'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import type * as Lib from '../../lib'

import '../../lib/mockTelemetry'

vi.mock('execa', () => ({
  default: vi.fn((cmd, params, options) => {
    return {
      cmd,
      params,
      options,
    }
  }),
}))

vi.mock('concurrently', () => ({
  default: vi.fn((commands, options) => ({
    commands,
    options,
  })),
}))

const mockedRedwoodConfig = {
  api: {},
  web: {},
  browser: {},
}

vi.mock('../../lib', async (importOriginal) => {
  const originalLib = await importOriginal<typeof Lib>()
  return {
    ...originalLib,
    runCommandTask: vi.fn((commands) => {
      return commands.map(({ cmd, args }: { cmd: string; args?: string[] }) => `${cmd} ${args?.join(' ')}`)
    }),
    getPaths: () => ({
      base: './myBasePath',
      api: {
        prismaConfig: '../../__fixtures__/test-project/api/prisma.config.ts',
      },
      web: {},
    }),
    getConfig: () => {
      return mockedRedwoodConfig
    },
  }
})

// @ts-expect-error - No types for .js files
import { runCommandTask } from '../../lib/index.js'
import { handler } from '../type-check.js'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  vi.mocked(console).info.mockRestore()
  vi.mocked(console).log.mockRestore()
})

test('Should run tsc commands correctly, in order', async () => {
  await handler({
    sides: ['web', 'api'],
    prisma: false,
    generate: true,
    verbose: false,
  })

  const concurrentlyArgs = vi.mocked(concurrently).mock.results[0].value

  expect(vi.mocked(execa).mock.results[0].value.cmd).toEqual('yarn rw-gen')

  // Ensure tsc command run correctly for web side
  expect(concurrentlyArgs.commands).toContainEqual({
    cwd: path.join('myBasePath', 'web'),
    command: 'yarn tsc --noEmit --skipLibCheck',
  })
  // Ensure tsc command run correctly for web side
  expect(concurrentlyArgs.commands).toContainEqual({
    cwd: path.join('myBasePath', 'api'),
    command: 'yarn tsc --noEmit --skipLibCheck',
  })
  // Ensure we have raw sequential output from tsc
  expect(concurrentlyArgs.options).toEqual({ group: true, raw: true })
})

test('Should generate prisma client', async () => {
  await handler({
    sides: ['api'],
    prisma: true,
    generate: true,
    verbose: false,
  })

  const concurrentlyArgs = vi.mocked(concurrently).mock.results[0].value

  expect(vi.mocked(execa).mock.results[0].value.cmd).toEqual('yarn rw-gen')

  // Ensure tsc command run correctly for web side
  expect(concurrentlyArgs.commands).toContainEqual({
    cwd: path.join('myBasePath', 'api'),
    command: 'yarn tsc --noEmit --skipLibCheck',
  })

  expect(vi.mocked(runCommandTask).mock.results[0].value[0]).toMatch(
    /.+(\\|\/)prisma(\\|\/)build(\\|\/)index.js.+/,
  )
})

