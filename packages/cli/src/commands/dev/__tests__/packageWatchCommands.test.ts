import fs from 'node:fs'

import { vi, afterEach, describe, it, expect, beforeEach } from 'vitest'

import { getPackageWatchCommands } from '../packageWatchCommands.js'

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

vi.mock('../../../lib/index.js', () => {
  return {
    getPaths: vi.fn(() => ({
      packages: '/mocked/project/packages',
    })),
  }
})

vi.mock('../../../lib/colors.js', () => ({
  default: {
    warning: (str: string) => `Warning: ${str}`,
    error: (str: string) => `Error: ${str}`,
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('getWatchPackagesCommands', () => {
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

    const commands = await getPackageWatchCommands(['packages/*'])

    expect(commands).toEqual([
      {
        name: 'foo',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/foo',
      },
      {
        name: 'bar',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/bar',
      },
      {
        name: 'baz',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/baz',
      },
    ])
  })

  it('watches specific package workspaces', async () => {
    const commands = await getPackageWatchCommands([
      '@my-org/pkg-one',
      'pkg-two',
    ])

    expect(commands).toEqual([
      {
        name: 'pkg-one',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/pkg-one',
      },
      {
        name: 'pkg-two',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/pkg-two',
      },
    ])
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
      // pathStr will be something like '/mocked/project/packages/foo/package.json'
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
          scripts: {
            // No watch script
            build: 'tsc',
          },
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

    const commands = await getPackageWatchCommands(['packages/*'])

    expect(commands).toEqual([
      {
        name: 'foo',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/foo',
      },
      {
        name: 'baz',
        command: 'yarn watch',
        cwd: '/mocked/project/packages/baz',
      },
    ])

    // Should warn about 'bar'
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Warning: .*skipped: .*bar.*/),
    )
  })

  it('returns an empty array when no watchable packages exist', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield '/mocked/project/packages/foo'
        return undefined
      })(),
    )

    vi.mocked(fs).readFileSync.mockReturnValue(
      JSON.stringify({
        name: 'foo',
        // No scripts section
      }),
    )

    const result = await getPackageWatchCommands(['packages/*'])

    expect(result).toEqual([])
  })

  it('handles empty packages directory', async () => {
    vi.mocked(fs.promises.glob).mockReturnValue(
      (async function* () {
        yield* []
        return undefined
      })(),
    )

    const result = await getPackageWatchCommands(['packages/*'])

    expect(result).toEqual([])
  })

  it('throws error for non-existent specific workspace', async () => {
    vi.mocked(fs).existsSync.mockReturnValue(false)

    await expect(async () => {
      await getPackageWatchCommands(['non-existent-package'])
    }).rejects.toThrow('Workspace not found')
  })
})
