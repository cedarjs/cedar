vi.mock('node:fs', () => {
  return {
    default: {
      existsSync: (path) => {
        return !path.includes('non-existing-package')
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

import fs from 'node:fs'

import concurrently from 'concurrently'
import { vi, afterEach, describe, it, expect } from 'vitest'

import { buildPackagesTask } from '../buildPackagesTask.js'

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildPackagesTask', async () => {
  it('expands packages/* to all packages', async () => {
    await buildPackagesTask({}, ['packages/*'])

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
      expect.objectContaining({
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      }),
    )
  })

  it('builds specific workspaces', async () => {
    await buildPackagesTask({}, ['@my-org/pkg-one', 'pkg-two'])

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
      expect.objectContaining({
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      }),
    )
  })

  it('handles no packages to build for glob', async () => {
    vi.mocked(fs).promises.glob.mockResolvedValue([])

    const mockTask = { skip: vi.fn() }
    await buildPackagesTask(mockTask, ['packages/*'])

    expect(vi.mocked(concurrently)).not.toHaveBeenCalled()
    expect(vi.mocked(mockTask.skip)).toHaveBeenCalledWith(
      'No packages to build at packages/*',
    )
  })

  it('handles no packages to build for specific packages', async () => {
    const mockTask = { skip: vi.fn() }
    await buildPackagesTask(mockTask, [
      'non-existing-package-one',
      'non-existing-package-two',
    ])

    expect(vi.mocked(concurrently)).not.toHaveBeenCalled()
    expect(vi.mocked(mockTask.skip)).toHaveBeenCalledWith(
      'No packages to build at non-existing-package-one, non-existing-package-two',
    )
  })

  it('handles mix of existing and non-existing packages to build', async () => {
    const mockTask = { skip: vi.fn() }
    await buildPackagesTask(mockTask, ['pkg-one', 'non-existing-package'])

    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn build',
          name: 'pkg-one',
          cwd: '/mocked/project/packages/pkg-one',
        },
      ],
      expect.objectContaining({
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      }),
    )
    // TODO: Maybe we should let the user know about the non-existing package
    // expect(vi.mocked(mockTask.skip)).toHaveBeenCalledWith(
    //   'No packages to build at non-existing-package',
    // )
  })

  it('throws when concurrently rejects with array of CloseEvent objects', async () => {
    // Reset glob mock in case a previous test changed it
    vi.mocked(fs).promises.glob.mockImplementation(() => {
      return [
        '/mocked/project/packages/foo',
        '/mocked/project/packages/bar',
        '/mocked/project/packages/baz',
      ]
    })

    // concurrently rejects with an array of CloseEvent objects, not an Error
    const closeEvents = [
      {
        command: { command: 'yarn build', name: 'validators' },
        index: 0,
        exitCode: 1,
        killed: false,
        timings: {},
      },
    ]

    vi.mocked(concurrently).mockReturnValue({
      result: Promise.reject(closeEvents),
    })

    await expect(
      buildPackagesTask({ skip: vi.fn() }, ['packages/*']),
    ).rejects.toThrow('"validators" exited with code 1')
  })

  it('throws when concurrently rejects with multiple failed commands', async () => {
    // Reset glob mock in case a previous test changed it
    vi.mocked(fs).promises.glob.mockImplementation(() => {
      return [
        '/mocked/project/packages/foo',
        '/mocked/project/packages/bar',
        '/mocked/project/packages/baz',
      ]
    })

    const closeEvents = [
      {
        command: { command: 'yarn build', name: 'pkg-a' },
        index: 0,
        exitCode: 1,
        killed: false,
        timings: {},
      },
      {
        command: { command: 'yarn build', name: 'pkg-b' },
        index: 1,
        exitCode: 0,
        killed: false,
        timings: {},
      },
      {
        command: { command: 'yarn build', name: 'pkg-c' },
        index: 2,
        exitCode: 2,
        killed: false,
        timings: {},
      },
    ]

    vi.mocked(concurrently).mockReturnValue({
      result: Promise.reject(closeEvents),
    })

    await expect(
      buildPackagesTask({ skip: vi.fn() }, ['packages/*']),
    ).rejects.toThrow(/\"pkg-a\" exited with code 1/)

    // Verify the error also mentions pkg-c but not pkg-b
    try {
      vi.mocked(concurrently).mockReturnValue({
        result: Promise.reject(closeEvents),
      })
      await buildPackagesTask({ skip: vi.fn() }, ['packages/*'])
    } catch (e) {
      expect(e.message).toContain('"pkg-c" exited with code 2')
      // pkg-b succeeded (exitCode 0), so it should not be mentioned
      expect(e.message).not.toContain('pkg-b')
    }
  })

  it('does not throw when all commands succeed', async () => {
    // Reset glob mock in case a previous test changed it
    vi.mocked(fs).promises.glob.mockImplementation(() => {
      return [
        '/mocked/project/packages/foo',
        '/mocked/project/packages/bar',
        '/mocked/project/packages/baz',
      ]
    })

    vi.mocked(concurrently).mockReturnValue({
      result: Promise.resolve(),
    })

    await expect(
      buildPackagesTask({ skip: vi.fn() }, ['packages/*']),
    ).resolves.toBeUndefined()
  })

  it('passes a custom outputStream to concurrently', async () => {
    await buildPackagesTask({}, ['packages/*'])

    const callArgs = vi.mocked(concurrently).mock.calls[0][1]
    expect(callArgs).toHaveProperty('outputStream')
    expect(callArgs.outputStream).toBeDefined()
  })
})
