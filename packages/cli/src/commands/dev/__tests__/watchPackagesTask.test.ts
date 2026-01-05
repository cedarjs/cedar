import fs from 'node:fs'

import concurrently from 'concurrently'
import { vi, afterEach, describe, it, expect, beforeEach } from 'vitest'

import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../../../lib/exit.js'
import { watchPackagesTask } from '../watchPackagesTask.js'

vi.mock('node:fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      promises: {
        glob: vi.fn(() => {
          // Return an async iterable
          return (async function* () {
            yield '/mocked/project/packages/foo'
            return undefined
          })()
        }),
      },
    },
  }
})

vi.mock('concurrently', () => ({
  default: vi.fn(() => ({ result: Promise.resolve(), commands: [] })),
}))

vi.mock('../../../lib/index.js', () => {
  return {
    getPaths: vi.fn(() => ({
      base: '/mocked/project',
      packages: '/mocked/project/packages',
    })),
  }
})

vi.mock('@cedarjs/telemetry', () => {
  return {
    errorTelemetry: vi.fn(),
  }
})

vi.mock('../../../lib/exit.js', () => ({
  exitWithError: vi.fn(),
}))

vi.mock('../../../lib/colors.js', () => ({
  default: {
    warning: (str: string) => `Warning: ${str}`,
    error: (str: string) => `Error: ${str}`,
  },
}))

vi.mock('@cedarjs/project-config', () => ({
  importStatementPath: (path: string) => path,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('watchPackagesTask', () => {
  beforeEach(() => {
    // Set up default successful mocks
    vi.mocked(fs).existsSync.mockReturnValue(true)
    vi.mocked(fs).readFileSync.mockReturnValue(
      JSON.stringify({
        name: 'test-package',
        scripts: { watch: 'tsc --watch' },
      }),
    )
    vi.mocked(console).warn = vi.fn()
  })

  it('expands packages/* to all packages', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        yield '/mocked/project/packages/bar'
        yield '/mocked/project/packages/baz'
        return undefined
      })(),
    )

    await watchPackagesTask(['packages/*'])

    expect(fs.promises.glob).toHaveBeenCalledOnce()
    expect(fs.promises.glob).toHaveBeenCalledWith('/mocked/project/packages/*')
    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn watch',
          name: 'foo',
          cwd: '/mocked/project/packages/foo',
          prefixColor: 'yellow',
        },
        {
          command: 'yarn watch',
          name: 'bar',
          cwd: '/mocked/project/packages/bar',
          prefixColor: 'yellow',
        },
        {
          command: 'yarn watch',
          name: 'baz',
          cwd: '/mocked/project/packages/baz',
          prefixColor: 'yellow',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      },
    )
  })

  it('watches specific package workspaces', async () => {
    await watchPackagesTask(['@my-org/pkg-one', 'pkg-two'])

    expect(fs.promises.glob).not.toHaveBeenCalled()
    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn watch',
          name: 'pkg-one',
          cwd: '/mocked/project/packages/pkg-one',
          prefixColor: 'yellow',
        },
        {
          command: 'yarn watch',
          name: 'pkg-two',
          cwd: '/mocked/project/packages/pkg-two',
          prefixColor: 'yellow',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      },
    )
  })

  it('filters out packages without watch script', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        yield '/mocked/project/packages/bar'
        yield '/mocked/project/packages/baz'
        return undefined
      })(),
    )

    vi.mocked(fs).readFileSync.mockImplementation((filePath) => {
      const pathStr = filePath.toString()
      if (pathStr.includes('foo')) {
        return JSON.stringify({
          name: 'foo',
          scripts: { watch: 'tsc --watch' },
        })
      }

      if (pathStr.includes('bar')) {
        return JSON.stringify({
          name: 'bar',
          scripts: { build: 'tsc' }, // No watch script!
        })
      }

      if (pathStr.includes('baz')) {
        return JSON.stringify({
          name: 'baz',
          scripts: { watch: 'tsc --watch' },
        })
      }
      return '{}'
    })

    await watchPackagesTask(['packages/*'])

    // Should only watch 'foo' and 'baz', not 'bar'
    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn watch',
          name: 'foo',
          cwd: '/mocked/project/packages/foo',
          prefixColor: 'yellow',
        },
        {
          command: 'yarn watch',
          name: 'baz',
          cwd: '/mocked/project/packages/baz',
          prefixColor: 'yellow',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      },
    )

    // Should warn about 'bar'
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Warning: '),
    )
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bar'))
  })

  it('returns null when no watchable packages exist', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        return undefined
      })(),
    )

    vi.mocked(fs).readFileSync.mockReturnValue(
      JSON.stringify({
        name: 'foo',
        scripts: { build: 'tsc' }, // No watch script
      }),
    )

    const result = await watchPackagesTask(['packages/*'])

    expect(result).toBeNull()
    expect(vi.mocked(concurrently)).not.toHaveBeenCalled()
  })

  it('handles empty packages directory', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield* []
        return undefined
      })(),
    )

    const result = await watchPackagesTask(['packages/*'])

    expect(result).toBeNull()
    expect(vi.mocked(concurrently)).not.toHaveBeenCalled()
  })

  it('handles package.json read errors gracefully', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        yield '/mocked/project/packages/bar'
        return undefined
      })(),
    )

    vi.mocked(fs).existsSync.mockImplementation((filePath) => {
      const pathStr = filePath.toString()
      // package.json doesn't exist for 'bar'
      return !pathStr.includes('bar')
    })

    vi.mocked(fs).readFileSync.mockImplementation((filePath) => {
      const pathStr = filePath.toString()
      if (pathStr.includes('foo')) {
        return JSON.stringify({
          name: 'foo',
          scripts: { watch: 'tsc --watch' },
        })
      }
      return '{}'
    })

    await watchPackagesTask(['packages/*'])

    // Should only watch 'foo', skip 'bar'
    expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
      [
        {
          command: 'yarn watch',
          name: 'foo',
          cwd: '/mocked/project/packages/foo',
          prefixColor: 'yellow',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
      },
    )
  })

  it('throws error for non-existent specific workspace', async () => {
    vi.mocked(fs).existsSync.mockReturnValue(false)

    await expect(async () => {
      await watchPackagesTask(['non-existent-package'])
    }).rejects.toThrow('Workspace not found')
  })

  it('handles concurrently errors', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        return undefined
      })(),
    )

    const error = new Error('Process failed')
    const resultPromise = Promise.reject(error)
    // Prevent unhandled rejection
    resultPromise.catch(() => {})

    vi.mocked(concurrently).mockReturnValue({
      result: resultPromise,
      commands: [],
    })

    watchPackagesTask(['packages/*'])

    // Wait for the error handling to complete
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(errorTelemetry).toHaveBeenCalledWith(
      process.argv,
      expect.stringContaining('Error watching packages'),
    )
    expect(exitWithError).toHaveBeenCalledWith(error)
  })

  it('warns about multiple packages without watch scripts', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        yield '/mocked/project/packages/bar'
        yield '/mocked/project/packages/baz'
        return undefined
      })(),
    )

    vi.mocked(fs).readFileSync.mockImplementation((filePath) => {
      const pathStr = filePath.toString()
      if (pathStr.includes('foo')) {
        return JSON.stringify({
          name: 'foo',
          scripts: { watch: 'tsc --watch' },
        })
      }

      // bar and baz don't have watch scripts
      return JSON.stringify({
        scripts: { build: 'tsc' },
      })
    })

    await watchPackagesTask(['packages/*'])

    // Should warn about both 'bar' and 'baz'
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bar'))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('baz'))
  })

  it('handles packages with no scripts section at all', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        return undefined
      })(),
    )

    vi.mocked(fs).readFileSync.mockReturnValue(
      JSON.stringify({
        name: 'foo',
        version: '1.0.0',
        // No scripts section at all
      }),
    )

    const result = await watchPackagesTask(['packages/*'])

    expect(result).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('foo'))
  })
})
