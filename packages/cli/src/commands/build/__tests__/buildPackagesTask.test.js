vi.mock('node:fs', () => {
  return {
    default: {
      existsSync: (_path) => {
        return true
      },
      readFileSync: () => {
        // Reading /mocked/project/package.json
        // It just needs a workspace config section
        return JSON.stringify({
          workspaces: ['api', 'web', 'packages/*'],
        })
      },
      promises: {
        glob: vi.fn(() => {
          return [
            '/mocked/project/packages/foo',
            '/mocked/project/packages/bar',
            '/mocked/project/packages/baz',
          ]
        }),
      },
    },
  }
})

vi.mock('concurrently', () => ({
  default: vi.fn(() => ({ result: Promise.resolve() })),
}))

vi.mock('../../../lib/index.js', () => {
  return {
    getPaths: () => {
      return {
        base: '/mocked/project',
        api: {
          dist: '/mocked/project/api/dist',
          prismaConfig: '/mocked/project/api/prisma.config.js',
        },
        packages: '/mocked/project/packages',
        web: {
          dist: '/mocked/project/web/dist',
          routes: '/mocked/project/web/Routes.tsx',
        },
      }
    },
  }
})

vi.mock('@cedarjs/telemetry', () => {
  return {
    errorTelemetry: () => vi.fn(),
    timedTelemetry: (_argv, _options, callback) => {
      return callback()
    },
  }
})

vi.mock('../../lib/exit.js', () => ({
  exitWithError: vi.fn(),
}))

import fs from 'node:fs'

import concurrently from 'concurrently'
import { vi, afterEach, describe, it, expect } from 'vitest'

import { buildPackagesTask } from '../buildPackagesTask.js'

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildPackagesTask', async () => {
  it('expands packages/* to all packages', async () => {
    await buildPackagesTask(['packages/*'])

    expect(vi.mocked(fs).promises.glob).toHaveBeenCalledOnce()
    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn build',
          name: 'foo',
          cwd: '/mocked/project/packages/foo',
        },
        {
          command: 'yarn build',
          name: 'bar',
          cwd: '/mocked/project/packages/bar',
        },
        {
          command: 'yarn build',
          name: 'baz',
          cwd: '/mocked/project/packages/baz',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      },
    )
  })

  it('builds specific workspaces', async () => {
    await buildPackagesTask(['@my-org/pkg-one', 'pkg-two'])

    expect(vi.mocked(fs).promises.glob).not.toHaveBeenCalled()
    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn build',
          name: 'pkg-one',
          cwd: '/mocked/project/packages/pkg-one',
        },
        {
          command: 'yarn build',
          name: 'pkg-two',
          cwd: '/mocked/project/packages/pkg-two',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      },
    )
  })
})
