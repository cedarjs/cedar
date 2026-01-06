import fs from 'node:fs'

import { vi, afterEach, describe, it, expect, beforeEach } from 'vitest'

import { getPackageWatchCommands } from '../packgeWatchCommands.js'

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

vi.mock('@cedarjs/project-config', () => ({
  importStatementPath: (path: string) => path,
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
        command: 'yarn watch',
        name: 'foo',
        cwd: '/mocked/project/packages/foo',
      },
      {
        command: 'yarn watch',
        name: 'bar',
        cwd: '/mocked/project/packages/bar',
      },
      {
        command: 'yarn watch',
        name: 'baz',
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
        command: 'yarn watch',
        name: 'pkg-one',
        cwd: '/mocked/project/packages/pkg-one',
      },
      {
        command: 'yarn watch',
        name: 'pkg-two',
        cwd: '/mocked/project/packages/pkg-two',
      },
    ])
  })

  // it('filters out packages without watch script', async () => {
  //   vi.mocked(fs.promises.glob).mockReturnValue(
  //     (async function* () {
  //       yield '/mocked/project/packages/foo'
  //       yield '/mocked/project/packages/bar'
  //       yield '/mocked/project/packages/baz'
  //       return undefined
  //     })(),
  //   )

  //   vi.mocked(fs).readFileSync.mockImplementation((filePath) => {
  //     const pathStr = filePath.toString()
  //     if (pathStr.includes('foo')) {
  //       return JSON.stringify({
  //         name: 'foo',
  //         scripts: { watch: 'tsc --watch' },
  //       })
  //     }

  //     if (pathStr.includes('bar')) {
  //       return JSON.stringify({
  //         name: 'bar',
  //         scripts: { build: 'tsc' }, // No watch script!
  //       })
  //     }

  //     if (pathStr.includes('baz')) {
  //       return JSON.stringify({
  //         name: 'baz',
  //         scripts: { watch: 'tsc --watch' },
  //       })
  //     }
  //     return '{}'
  //   })

  //   await watchPackagesTask(['packages/*'])

  //   // Should only watch 'foo' and 'baz', not 'bar'
  //   expect(vi.mocked(concurrently)).toHaveBeenCalledWith(
  //     [
  //       {
  //         command: 'yarn watch',
  //         name: 'foo',
  //         cwd: '/mocked/project/packages/foo',
  //         prefixColor: 'yellow',
  //       },
  //       {
  //         command: 'yarn watch',
  //         name: 'baz',
  //         cwd: '/mocked/project/packages/baz',
  //         prefixColor: 'yellow',
  //       },
  //     ],
  //     {
  //       prefix: '{name} |',
  //       timestampFormat: 'HH:mm:ss',
  //     },
  //   )

  //   // Should warn about 'bar'
  //   expect(console.warn).toHaveBeenCalledWith(
  //     expect.stringContaining('Warning: '),
  //   )
  //   expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bar'))
  // })

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
        scripts: {
          // No watch script
          build: 'tsc',
        },
      }),
    )

    const result = await getPackageWatchCommands(['packages/*'])

    expect(result).toEqual([])
  })

  // it('handles empty packages directory', async () => {
  //   vi.mocked(fs.promises.glob).mockReturnValue(
  //     (async function* () {
  //       yield* []
  //       return undefined
  //     })(),
  //   )

  //   const result = await watchPackagesTask(['packages/*'])

  //   expect(result).toBeNull()
  //   expect(vi.mocked(concurrently)).not.toHaveBeenCalled()
  // })

  // it('throws error for non-existent specific workspace', async () => {
  //   vi.mocked(fs).existsSync.mockReturnValue(false)

  //   await expect(async () => {
  //     await watchPackagesTask(['non-existent-package'])
  //   }).rejects.toThrow('Workspace not found')
  // })

  // it('warns about multiple packages without watch scripts', async () => {
  //   vi.mocked(fs.promises.glob).mockReturnValue(
  //     (async function* () {
  //       yield '/mocked/project/packages/foo'
  //       yield '/mocked/project/packages/bar'
  //       yield '/mocked/project/packages/baz'
  //       return undefined
  //     })(),
  //   )

  //   vi.mocked(fs).readFileSync.mockImplementation((filePath) => {
  //     const pathStr = filePath.toString()
  //     if (pathStr.includes('foo')) {
  //       return JSON.stringify({
  //         name: 'foo',
  //         scripts: { watch: 'tsc --watch' },
  //       })
  //     }

  //     // bar and baz don't have watch scripts
  //     return JSON.stringify({
  //       scripts: { build: 'tsc' },
  //     })
  //   })

  //   await watchPackagesTask(['packages/*'])

  //   // Should warn about both 'bar' and 'baz'
  //   expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bar'))
  //   expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('baz'))
  // })

  // it('handles packages with no scripts section at all', async () => {
  //   vi.mocked(fs.promises.glob).mockReturnValue(
  //     (async function* () {
  //       yield '/mocked/project/packages/foo'
  //       return undefined
  //     })(),
  //   )

  //   vi.mocked(fs).readFileSync.mockReturnValue(
  //     JSON.stringify({
  //       name: 'foo',
  //       version: '1.0.0',
  //       // No scripts section at all
  //     }),
  //   )

  //   const result = await watchPackagesTask(['packages/*'])

  //   expect(result).toBeNull()
  //   expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('foo'))
  // })
})
