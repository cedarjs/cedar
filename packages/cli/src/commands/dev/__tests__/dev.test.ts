import type FS from 'fs'

import type { ConcurrentlyCommandInput } from 'concurrently'
import concurrently from 'concurrently'
import find from 'lodash/find.js'
import { vi, describe, afterEach, it, expect } from 'vitest'

import { getConfig } from '@cedarjs/project-config'
import type * as ProjectConfig from '@cedarjs/project-config'

import { generatePrismaClient } from '../../../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../../lib/index.js'
import '../../../lib/mockTelemetry.js'
import { handler } from '../devHandler.js'

let mockCedarToml = ''

vi.mock('concurrently', () => ({
  __esModule: true, // this property makes it work
  default: vi.fn().mockReturnValue({
    result: {
      then: () => new Promise(() => {}),
      catch: () => {},
    },
  }),
}))

// dev checks for existence of api/src and web/src folders
vi.mock('node:fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof FS>()

  return {
    default: {
      ...actualFs,
      readFileSync: (filePath: string) => {
        if (filePath.endsWith('.json')) {
          // For a test, using `any` will have to be good enough
          const packageJson: Record<string, any> = {
            workspaces: ['api', 'web', 'packages/*'],
          }

          if (filePath.includes('esm-project')) {
            packageJson.type = 'module'
          }

          return JSON.stringify(packageJson)
        } else if (filePath.endsWith('cedar.toml')) {
          return mockCedarToml
        }

        return 'File content'
      },
      existsSync: () => true,
    },
  }
})

vi.mock('@cedarjs/internal/dist/dev', () => {
  return {
    shutdownPort: vi.fn(),
  }
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<typeof ProjectConfig>()

  return {
    getConfig: vi.fn(() => {
      return originalProjectConfig.getConfig()
    }),
    getConfigPath: vi.fn(() => '/mocked/project/cedar.toml'),
  }
})

vi.mock('../../../lib/generatePrismaClient', () => {
  return {
    generatePrismaClient: vi.fn().mockResolvedValue(true),
  }
})

vi.mock('../packageWatchCommands.js', () => ({
  getPackageWatchCommands: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../lib/ports', () => {
  return {
    // We're not actually going to use the port, so it's fine to just say it's
    // free. It prevents the tests from failing if the ports are already in use
    // (probably by some external `yarn cedar dev` process)
    getFreePort: (port: number) => port,
  }
})

vi.mock('../../../lib/index.js', () => ({
  getPaths: vi.fn(() => {
    return {
      base: '/mocked/project',
      api: {
        base: '/mocked/project/api',
        src: '/mocked/project/api/src',
        functions: '/mocked/project/api/src/functions',
        dist: '/mocked/project/api/dist',
        functions: '/mocked/project/api/src/functions',
      },
      web: {
        base: '/mocked/project/web',
        src: '/mocked/project/web/src',
        dist: '/mocked/project/web/dist',
      },
      packages: '/mocked/project/packages',
      generated: {
        base: '/mocked/project/.cedar',
      },
    }
  }),
}))

vi.mock('../../../lib/project.js', () => ({
  serverFileExists: vi.fn(() => false),
}))

async function defaultConfig() {
  const actualProjectConfig = await vi.importActual<typeof ProjectConfig>(
    '@cedarjs/project-config',
  )
  const config = actualProjectConfig.getConfig()

  return config
}

/**
 * In the default (unified) dev mode, `concurrently` receives a single command
 * named 'dev' that starts both the web Vite client and the API Vite SSR server
 * in a single process.
 *
 * This function finds that command and returns it.
 */
function findUnifiedDevCommand() {
  const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]

  const devCommand = find(concurrentlyArgs, { name: 'dev' })

  if (!devCommand || typeof devCommand === 'string') {
    throw new Error('Missing unified dev command')
  }

  return devCommand
}

// When only one workspace selected is selected, or we're running in SSR mode,
// separate 'api' and 'web' commands are used.
type ConcurrentlyCommandObject = {
  command: string
  env?: Record<string, string>
  name?: string
}

function asCommandInfo(
  cmd: ConcurrentlyCommandInput | undefined,
): ConcurrentlyCommandObject | undefined {
  if (!cmd || typeof cmd === 'string') {
    return undefined
  }
  return cmd as ConcurrentlyCommandObject
}

function findSeparateCommands() {
  const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]

  const webCommand = asCommandInfo(find(concurrentlyArgs, { name: 'web' }))
  const apiCommand = asCommandInfo(find(concurrentlyArgs, { name: 'api' }))
  const generateCommand = asCommandInfo(find(concurrentlyArgs, { name: 'gen' }))

  return {
    webCommand,
    apiCommand,
    generateCommand,
  }
}

function findApiCommands() {
  const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]

  const apiCommand = find(concurrentlyArgs, { name: 'api' })

  if (!apiCommand) {
    throw new Error('Missing command')
  }

  if (typeof apiCommand === 'string') {
    throw new Error('Unexpected command')
  }

  return apiCommand
}

describe('yarn cedar dev', () => {
  afterEach(async () => {
    // Reset spy counters
    vi.clearAllMocks()
    vi.mocked(getPaths).mockReset()
    vi.mocked(getConfig).mockReset()
    mockCedarToml = ''
  })

  it('Should run unified dev server (both api and web) by default', async () => {
    await handler({ workspace: ['api', 'web'] })

    expect(generatePrismaClient).toHaveBeenCalledTimes(1)

    const devCommand = findUnifiedDevCommand()

    // The unified command runs cedar-unified-dev with both ports
    expect(devCommand.command).toContain('cedar-unified-dev')
    expect(devCommand.command).toContain('--port 8910')
    expect(devCommand.command).toContain('--apiPort 8911')
    expect(devCommand.env?.NODE_ENV).toEqual('development')
    expect(devCommand.env?.NODE_OPTIONS).toContain('--enable-source-maps')

    // No separate api/web commands should be present
    const { webCommand, apiCommand } = findSeparateCommands()
    expect(webCommand).toBeUndefined()
    expect(apiCommand).toBeUndefined()
  })

  it('Should include the gen watcher alongside the unified dev server', async () => {
    await handler({ workspace: ['api', 'web'] })

    const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]
    const genCommand = find(concurrentlyArgs, { name: 'gen' })

    expect(genCommand).toBeDefined()
    if (typeof genCommand !== 'string' && genCommand) {
      expect(genCommand.command).toEqual('yarn cedar-gen-watch')
    }
  })

  it('Should fall back to separate api+web servers when streaming SSR is enabled', async () => {
    const config = await defaultConfig()

    vi.mocked(getConfig).mockReturnValue({
      ...config,
      experimental: {
        ...config.experimental,
        streamingSsr: {
          enabled: true,
        },
      },
    })

    await handler({ workspace: ['api', 'web'] })

    expect(generatePrismaClient).toHaveBeenCalledTimes(1)

    const { webCommand, apiCommand, generateCommand } = findSeparateCommands()

    // In streaming SSR mode the web side uses the cedar-dev-fe server
    expect(webCommand?.command).toContain(
      'yarn cross-env NODE_ENV=development cedar-dev-fe',
    )

    // API side uses nodemon with cedar-api-server-watch in streaming SSR fallback mode
    expect(
      apiCommand?.command
        .replace(/\s+/g, ' ')
        // Remove the --max-old-space-size flag, as it's not consistent across
        // test environments (vite sets this in their vite-ecosystem-ci tests)
        .replace(/--max-old-space-size=\d+\s/, ''),
    ).toEqual(
      'yarn nodemon --quiet --watch "/mocked/project/cedar.toml" --exec "yarn cedar-api-server-watch --port 8911 --debug-port 18911 | cedar-log-formatter"',
    )
    expect(apiCommand?.env?.NODE_ENV).toEqual('development')
    expect(apiCommand?.env?.NODE_OPTIONS).toContain('--enable-source-maps')

    expect(generateCommand?.command).toEqual('yarn cedar-gen-watch')

    // No unified dev command should be present
    const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]
    const devCommand = find(concurrentlyArgs, { name: 'dev' })
    expect(devCommand).toBeUndefined()
  })

  it('Should fall back to separate servers when only api workspace is requested', async () => {
    await handler({ workspace: ['api'] })

    expect(generatePrismaClient).toHaveBeenCalledTimes(1)

    const { apiCommand } = findSeparateCommands()

    // API uses cedar-api-server-watch when running solo
    expect(apiCommand?.command).toContain('cedar-api-server-watch')
    expect(apiCommand?.command).toContain('--port 8911')
    expect(apiCommand?.env?.NODE_ENV).toEqual('development')
    expect(apiCommand?.env?.NODE_OPTIONS).toContain('--enable-source-maps')

    // No unified dev command should be present
    const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]
    const devCommand = find(concurrentlyArgs, { name: 'dev' })
    expect(devCommand).toBeUndefined()
  })

  it('Should fall back to web-only Vite dev server when only web workspace is requested', async () => {
    await handler({ workspace: ['web'] })

    const { webCommand } = findSeparateCommands()

    expect(webCommand?.command).toContain(
      'yarn cross-env NODE_ENV=development cedar-vite-dev',
    )

    // No unified dev command and no api command
    const concurrentlyArgs = vi.mocked(concurrently).mock.lastCall![0]
    const devCommand = find(concurrentlyArgs, { name: 'dev' })
    const apiCommand = find(concurrentlyArgs, { name: 'api' })
    expect(devCommand).toBeUndefined()
    expect(apiCommand).toBeUndefined()
  })

  it('Should use esm api-server-watch bin in fallback mode for esm projects', async () => {
    vi.mocked(getPaths).mockReturnValue({
      base: '/mocked/esm-project',
      api: {
        base: '/mocked/esm-project/api',
        src: '/mocked/esm-project/api/src',
        dist: '/mocked/esm-project/api/dist',
        functions: '/mocked/esm-project/api/src/functions',
      },
      web: {
        base: '/mocked/esm-project/web',
        src: '/mocked/esm-project/web/src',
        dist: '/mocked/esm-project/web/dist',
      },
      packages: '/mocked/esm-project/packages',
      generated: {
        base: '/mocked/esm-project/.cedar',
      },
    })

    // Request only API so we hit the fallback path
    await handler({ workspace: ['api'] })

    const { apiCommand } = findSeparateCommands()

    // ESM project should use the ESM bin
    expect(apiCommand?.command).toContain('cedarjs-api-server-watch')
    expect(apiCommand?.command).toContain('--port 8911')
  })

  it('Debug port passed in command line overrides TOML', async () => {
    await handler({ workspace: ['api'], apiDebugPort: 90909090 })

    const apiCommand = findApiCommands()

    expect(apiCommand.command.replace(/\s+/g, ' ')).toContain(
      'yarn cedar-api-server-watch --port 8911 --debug-port 90909090',
    )
  })

  it('Can disable debugger by setting toml to false', async () => {
    mockCedarToml = `
      [api]
        port = 8913
        debugPort = false
    `

    await handler({ workspace: ['api'] })

    const apiCommand = findApiCommands()

    expect(apiCommand.command).not.toContain('--debug-port')
  })

  it('Derives debug port from api port when not explicitly configured', async () => {
    mockCedarToml = `
      [api]
        port = 1337
        # no debugPort, so it should be derived to 11337
    `

    await handler({ workspace: ['api'] })

    const apiCommand = findApiCommands()

    expect(apiCommand.command.replace(/\s+/g, ' ')).toContain('--port 1337')
    expect(apiCommand.command.replace(/\s+/g, ' ')).toContain(
      '--debug-port 11337',
    )
  })
})
