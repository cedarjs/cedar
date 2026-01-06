import '../../../lib/mockTelemetry'

vi.mock('concurrently', () => ({
  __esModule: true,
  default: vi.fn().mockReturnValue({
    result: {
      catch: () => {},
    },
  }),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof FS>()

  return {
    default: {
      ...actualFs,
      readFileSync: vi.fn((filePath) => {
        if (!filePath) {
          return 'File content'
        }

        const pathStr = filePath.toString()
        if (pathStr.endsWith('package.json')) {
          // Root package.json with workspaces by default
          return '{ "workspaces": ["api", "web", "packages/*"] }'
        }

        return 'File content'
      }),
      existsSync: vi.fn(() => {
        return true
      }),
    },
  }
})

vi.mock('@cedarjs/internal/dist/dev', () => {
  return {
    shutdownPort: vi.fn(),
  }
})

vi.mock('@cedarjs/project-config', async (importActual) => {
  const actualProjectConfig = await importActual<typeof ProjectConfig>()

  return {
    ...actualProjectConfig,
    getConfig: vi.fn(() => actualProjectConfig.DEFAULT_CONFIG),
    getConfigPath: vi.fn(() => '/mocked/project/redwood.toml'),
  }
})

vi.mock('../../../lib/generatePrismaClient', () => {
  return {
    generatePrismaClient: vi.fn().mockResolvedValue(true),
  }
})

vi.mock('../../../lib/ports', () => {
  return {
    getFreePort: (port: number) => port,
  }
})

vi.mock('../../../lib/index.js', () => ({
  getPaths: vi.fn(() => ({
    base: '/mocked/project',
    api: {
      base: '/mocked/project/api',
      src: '/mocked/project/api/src',
      dist: '/mocked/project/api/dist',
    },
    web: {
      base: '/mocked/project/web',
      dist: '/mocked/project/web/dist',
    },
    packages: '/mocked/project/packages',
    generated: {
      base: '/mocked/project/.redwood',
    },
  })),
}))

vi.mock('../../../lib/project.js', () => ({
  serverFileExists: vi.fn(() => false),
}))

vi.mock('../build/buildPackagesTask.js', () => ({
  buildPackagesTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../packageWatchCommands.js', () => ({
  getPackageWatchCommands: vi.fn((packageWorkspaces: string[]) => {
    if (packageWorkspaces.includes('packages/*')) {
      return [
        {
          name: 'mock-package-one',
          command: 'yarn watch',
          cwd: '/mocked/project/packages/mock-package-one',
        },
        {
          name: 'mock-package-two',
          command: 'yarn watch',
          cwd: '/mocked/project/packages/mock-package-two',
        },
      ]
    }

    const names = packageWorkspaces.map((w) => w.split('/').at(-1))

    return names.map((name) => ({
      name,
      command: 'yarn watch',
      cwd: '/mocked/project/packages/' + name,
    }))
  }),
}))

import type FS from 'node:fs'

import concurrently, { type Command } from 'concurrently'
import { vi, describe, afterEach, it, expect } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { handler } from '../devHandler.js'

function isPackagesCommand(
  command: string | Command | undefined | Partial<Command>,
): command is Command {
  return (
    typeof command === 'object' &&
    command !== null &&
    'name' in command &&
    !!(command.name?.includes('mock-package') || command.name?.includes('pkg'))
  )
}

describe('yarn cedar dev - package watching', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not run package watchers when only api and web workspaces are specified', async () => {
    await handler({ workspace: ['api', 'web'] })

    expect(concurrently).toHaveBeenCalledOnce()

    const concurrentlyCommands = vi.mocked(concurrently).mock.calls[0][0]
    const packagesCommands = concurrentlyCommands.filter(isPackagesCommand)

    expect(packagesCommands).toHaveLength(0)
  })

  it('runs specific package watchers when requested', async () => {
    await handler({ workspace: ['api', 'my-pkg'] })

    expect(concurrently).toHaveBeenCalledOnce()

    const concurrentlyCommands = vi.mocked(concurrently).mock.calls[0][0]
    const packagesCommands = concurrentlyCommands.filter(isPackagesCommand)

    expect(packagesCommands).toHaveLength(1)
    expect(packagesCommands[0]).toMatchObject({
      name: 'my-pkg',
    })
  })

  it('registers packages job for default workspace arg', async () => {
    await handler({})

    expect(concurrently).toHaveBeenCalledOnce()

    const concurrentlyCommands = vi.mocked(concurrently).mock.calls[0][0]
    const packagesCommands = concurrentlyCommands.filter(isPackagesCommand)

    expect(packagesCommands).toHaveLength(2)
    expect(packagesCommands[0]).toMatchObject({
      name: 'mock-package-one',
    })
    expect(packagesCommands[1]).toMatchObject({
      name: 'mock-package-two',
    })
  })

  it('registers packages job for specific package sides', async () => {
    await handler({ workspace: ['@org/pkg-one', 'pkg-two'] })

    expect(concurrently).toHaveBeenCalledOnce()

    const concurrentlyCommands = vi.mocked(concurrently).mock.calls[0][0]
    const packagesCommands = concurrentlyCommands.filter(isPackagesCommand)

    expect(packagesCommands).toHaveLength(2)
    expect(packagesCommands[0]).toMatchObject({
      name: 'pkg-one',
    })
    expect(packagesCommands[1]).toMatchObject({
      name: 'pkg-two',
    })
  })
})
