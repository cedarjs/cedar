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

vi.mock('execa', () => ({
  default: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
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
    errorTelemetry: vi.fn(),
    timedTelemetry: (_argv, _options, callback) => {
      return callback()
    },
  }
})

import fs from 'node:fs'

import execa from 'execa'
import { vi, afterEach, describe, it, expect } from 'vitest'

import { errorTelemetry } from '@cedarjs/telemetry'

import { buildPackagesTask } from '../buildPackagesTask.js'

/**
 * Creates a mock Listr task object with a `newListr` spy that captures
 * the subtask definitions and options passed to it.
 */
function createMockTask() {
  const mockTask = {
    skip: vi.fn(),
    newListr: vi.fn((subtasks, options) => {
      // Store for inspection in tests
      mockTask._subtasks = subtasks
      mockTask._subtaskOptions = options
    }),
    _subtasks: [],
    _subtaskOptions: {},
  }

  return mockTask
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildPackagesTask', () => {
  it('expands packages/* to all packages', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    expect(vi.mocked(fs).promises.glob).toHaveBeenCalledOnce()
    expect(mockTask.newListr).toHaveBeenCalledOnce()

    const subtasks = mockTask._subtasks
    expect(subtasks).toHaveLength(3)
    expect(subtasks[0]).toMatchObject({ title: 'foo' })
    expect(subtasks[1]).toMatchObject({ title: 'bar' })
    expect(subtasks[2]).toMatchObject({ title: 'baz' })
  })

  it('creates subtasks that run yarn build in the correct cwd', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    // Execute each subtask and verify execa is called correctly
    for (const subtask of mockTask._subtasks) {
      await subtask.task()
    }

    expect(vi.mocked(execa)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(execa)).toHaveBeenCalledWith('yarn', ['build'], {
      cwd: '/mocked/project/packages/foo',
    })
    expect(vi.mocked(execa)).toHaveBeenCalledWith('yarn', ['build'], {
      cwd: '/mocked/project/packages/bar',
    })
    expect(vi.mocked(execa)).toHaveBeenCalledWith('yarn', ['build'], {
      cwd: '/mocked/project/packages/baz',
    })
  })

  it('runs subtasks concurrently with subtasks visible', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    expect(mockTask._subtaskOptions).toMatchObject({
      concurrent: true,
      rendererOptions: { collapseSubtasks: false },
    })
  })

  it('builds specific workspaces', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['@my-org/pkg-one', 'pkg-two'])

    expect(vi.mocked(fs).promises.glob).not.toHaveBeenCalled()
    expect(mockTask.newListr).toHaveBeenCalledOnce()

    const subtasks = mockTask._subtasks
    expect(subtasks).toHaveLength(2)
    expect(subtasks[0]).toMatchObject({ title: 'pkg-one' })
    expect(subtasks[1]).toMatchObject({ title: 'pkg-two' })
  })

  it('handles no packages to build for glob', async () => {
    vi.mocked(fs).promises.glob.mockResolvedValue([])

    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    expect(mockTask.newListr).not.toHaveBeenCalled()
    expect(mockTask.skip).toHaveBeenCalledWith(
      'No packages to build at packages/*',
    )
  })

  it('handles no packages to build for specific packages', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, [
      'non-existing-package-one',
      'non-existing-package-two',
    ])

    expect(mockTask.newListr).not.toHaveBeenCalled()
    expect(mockTask.skip).toHaveBeenCalledWith(
      'No packages to build at non-existing-package-one, non-existing-package-two',
    )
  })

  it('handles mix of existing and non-existing packages to build', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['pkg-one', 'non-existing-package'])

    expect(mockTask.newListr).toHaveBeenCalledOnce()

    const subtasks = mockTask._subtasks
    expect(subtasks).toHaveLength(1)
    expect(subtasks[0]).toMatchObject({ title: 'pkg-one' })
  })

  it('throws with stderr when a package build fails', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    const execaError = new Error('Command failed with exit code 1')
    execaError.stderr = 'error TS2345: Type string is not assignable to number'

    const fooSubtask = mockTask._subtasks[0]

    vi.mocked(execa).mockRejectedValueOnce(execaError)
    await expect(fooSubtask.task()).rejects.toThrow('Building "foo" failed')

    vi.mocked(execa).mockRejectedValueOnce(execaError)
    await expect(fooSubtask.task()).rejects.toThrow(
      /Type string is not assignable/,
    )
  })

  it('falls back to error message when stderr is empty', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    const execaError = new Error('Command failed with exit code 1')
    execaError.stderr = ''
    vi.mocked(execa).mockRejectedValueOnce(execaError)

    const fooSubtask = mockTask._subtasks[0]
    await expect(fooSubtask.task()).rejects.toThrow(
      'Command failed with exit code 1',
    )
  })

  it('reports error telemetry when a package build fails', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    const execaError = new Error('Command failed with exit code 1')
    execaError.stderr = 'some compilation error'
    vi.mocked(execa).mockRejectedValueOnce(execaError)

    const fooSubtask = mockTask._subtasks[0]

    try {
      await fooSubtask.task()
    } catch {
      // expected
    }

    expect(vi.mocked(errorTelemetry)).toHaveBeenCalledOnce()
    expect(vi.mocked(errorTelemetry)).toHaveBeenCalledWith(
      process.argv,
      expect.stringContaining('Error building package "foo"'),
    )
  })

  it('does not throw when all packages build successfully', async () => {
    const mockTask = createMockTask()
    await buildPackagesTask(mockTask, ['packages/*'])

    // execa resolves by default in our mock
    for (const subtask of mockTask._subtasks) {
      await expect(subtask.task()).resolves.toBeUndefined()
    }
  })
})
