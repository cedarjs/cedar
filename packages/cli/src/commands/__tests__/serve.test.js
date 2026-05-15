import fs from 'node:fs'

import { vi, describe, afterEach, beforeEach, it, expect } from 'vitest'
import yargs from 'yargs/yargs'

import * as apiServerCLIConfig from '@cedarjs/api-server/apiCliConfig'
import * as bothServerCLIConfig from '@cedarjs/api-server/bothCliConfig'
import * as apiServerCLIConfigHandler from '@cedarjs/api-server/cjs/apiCliConfigHandler'

import { builder } from '../serve.ts'

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

describe('yarn cedar serve', () => {
  beforeEach(() => {
    mocks.isEsm = true
    vi.spyOn(fs, 'existsSync').mockImplementation((pathToCheck) => {
      const normalizedPath = pathToCheck.toString().replaceAll('\\', '/')

      // Don't detect the server file
      return !normalizedPath.includes('/mocked/project/api/src/server.')
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Should proxy serve api with params to api-server handler', async () => {
    const parser = yargs().command('serve [side]', false, builder)

    await parser.parse(
      'serve api --port 5555 --apiRootPath funkyFunctions --no-ud',
    )

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

    await parser.parse(
      'serve api --port 5555 --apiRootPath funkyFunctions --no-ud',
    )

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
      'serve api --port 5555 --rootPath funkyFunctions/nested/ --no-ud',
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
      'serve api --port 5555 --rootPath funkyFunctions/nested/ --no-ud',
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

  it('Should reject --port flag when --ud is used on both sides', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const parser = yargs().command('serve [side]', false, builder)

    await expect(parser.parse('serve --port 9898 --ud')).rejects.toThrow(
      'process.exit called',
    )

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--port flag is not supported with --ud'),
    )

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('Should error when UD entry is missing for both sides with --ud', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.spyOn(fs, 'existsSync').mockImplementation((pathToCheck) => {
      const normalizedPath = pathToCheck.toString().replaceAll('\\', '/')
      // UD entry doesn't exist (check for index with any extension. The code
      // accepts both .js and .mjs)
      if (normalizedPath.includes('/mocked/project/api/dist/ud/index')) {
        return false
      }

      // web dist exists
      if (normalizedPath.includes('/mocked/project/web/dist')) {
        return true
      }

      // api base exists
      if (normalizedPath.includes('/mocked/project/api')) {
        return true
      }

      // Don't detect the server file
      return !normalizedPath.includes('/mocked/project/api/src/server.')
    })

    const parser = yargs().command('serve [side]', false, builder)

    await expect(parser.parse('serve --ud')).rejects.toThrow(
      'process.exit called',
    )

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('yarn cedar build --ud'),
    )

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('Should error when web dist is missing for both sides with --ud', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.spyOn(fs, 'existsSync').mockImplementation((pathToCheck) => {
      const normalizedPath = pathToCheck.toString().replaceAll('\\', '/')
      // UD entry exists (check for index with any extension — the
      // code uses resolveUDEntryPath which accepts both .js and .mjs)
      if (normalizedPath.includes('/mocked/project/api/dist/ud/index')) {
        return true
      }
      // web dist index.html doesn't exist
      if (normalizedPath.includes('/mocked/project/web/dist/index.html')) {
        return false
      }
      // api base exists
      if (normalizedPath.includes('/mocked/project/api')) {
        return true
      }
      // Don't detect the server file
      return !normalizedPath.includes('/mocked/project/api/src/server.')
    })

    const parser = yargs().command('serve [side]', false, builder)

    await expect(parser.parse('serve --ud')).rejects.toThrow(
      'process.exit called',
    )

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Web build artifacts not found'),
    )

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
