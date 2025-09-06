import { vi, describe, afterEach, beforeEach, it, expect } from 'vitest'
import yargs from 'yargs/yargs'

import * as apiServerCLIConfig from '@cedarjs/api-server/apiCliConfig'
import * as bothServerCLIConfig from '@cedarjs/api-server/bothCliConfig'
import * as apiServerCLIConfigHandler from '@cedarjs/api-server/cjs/apiCliConfigHandler'

import { builder } from '../serve.js'

globalThis.__dirname = __dirname

const mocks = vi.hoisted(() => ({
  isEsm: true,
}))

// We mock these to skip the check for web/dist and api/dist
vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal()
  return {
    ...originalProjectConfig,
    getPaths: () => {
      return {
        api: {
          base: '/mocked/project/api',
          src: '/mocked/project/api/src',
          dist: '/mocked/project/api/dist',
        },
        web: {
          base: '/mocked/project/web',
          dist: '/mocked/project/web/dist',
        },
      }
    },
    getConfig: () => {
      return {
        api: {},
      }
    },
    projectIsEsm: () => mocks.isEsm,
  }
})

vi.mock('fs-extra', async (importOriginal) => {
  const originalFsExtra = await importOriginal()
  return {
    default: {
      ...originalFsExtra,
      existsSync: (p) => {
        // Don't detect the server file, can't use path.sep here so the replaceAll is used
        if (p.replaceAll('\\', '/') === '/mocked/project/api/src/server.ts') {
          return false
        }
        return true
      },
    },
  }
})

vi.mock('@cedarjs/api-server/apiCliConfig', async (importOriginal) => {
  const originalAPICLIConfig = await importOriginal()
  return {
    description: originalAPICLIConfig.description,
    builder: originalAPICLIConfig.builder,
    handler: vi.fn(),
  }
})
vi.mock('@cedarjs/api-server/cjs/apiCliConfigHandler', async () => {
  return {
    handler: vi.fn(),
  }
})
vi.mock('@cedarjs/api-server/bothCliConfig', async (importOriginal) => {
  const originalBothCLIConfig = await importOriginal()
  return {
    description: originalBothCLIConfig.description,
    builder: originalBothCLIConfig.builder,
    handler: vi.fn(),
  }
})
vi.mock('execa', () => ({
  default: vi.fn((cmd, params) => ({
    cmd,
    params,
  })),
}))

describe('yarn rw serve', () => {
  beforeEach(() => {
    mocks.isEsm = true
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Should proxy serve api with params to api-server handler', async () => {
    const parser = yargs().command('serve [side]', false, builder)

    await parser.parse('serve api --port 5555 --apiRootPath funkyFunctions')

    expect(apiServerCLIConfig.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 5555,
        apiRootPath: expect.stringMatching(/^\/?funkyFunctions\/?$/),
      }),
    )
  })

  it('Should proxy serve api with params to api-server handler for CJS projects', async () => {
    mocks.isEsm = false

    const parser = yargs().command('serve [side]', false, builder)

    await parser.parse('serve api --port 5555 --apiRootPath funkyFunctions')

    expect(apiServerCLIConfigHandler.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 5555,
        apiRootPath: expect.stringMatching(/^\/?funkyFunctions\/?$/),
      }),
    )
  })

  it('Should proxy serve api with params to api-server handler (alias and slashes in path)', async () => {
    const parser = yargs().command('serve [side]', false, builder)

    await parser.parse(
      'serve api --port 5555 --rootPath funkyFunctions/nested/',
    )

    expect(apiServerCLIConfig.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 5555,
        rootPath: expect.stringMatching(/^\/?funkyFunctions\/nested\/$/),
      }),
    )
  })

  it('Should proxy serve api with params to api-server handler (alias and slashes in path) for CJS projects', async () => {
    mocks.isEsm = false

    const parser = yargs().command('serve [side]', false, builder)

    await parser.parse(
      'serve api --port 5555 --rootPath funkyFunctions/nested/',
    )

    expect(apiServerCLIConfigHandler.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 5555,
        rootPath: expect.stringMatching(/^\/?funkyFunctions\/nested\/$/),
      }),
    )
  })

  it('Should proxy rw serve with params to appropriate handler', async () => {
    const parser = yargs().command('serve [side]', false, builder)

    await parser.parse('serve --port 9898 --socket abc')

    expect(bothServerCLIConfig.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 9898,
        socket: 'abc',
      }),
    )
  })
})
