import path from 'path'

import pino from 'pino'
import build from 'pino-abstract-transport'
import {
  vi,
  beforeAll,
  afterAll,
  describe,
  afterEach,
  it,
  expect,
} from 'vitest'
import type { MockInstance } from 'vitest'

import { getConfig } from '@cedarjs/project-config'

import type { createServer as tCreateServer } from '../createServer.js'
import {
  resolveOptions,
  getDefaultCreateServerOptions,
} from '../createServerHelpers'

// Performance monitoring for debugging timeouts
const perfLog = (message: string, startTime?: number) => {
  const timestamp = new Date().toISOString()
  const duration = startTime
    ? ` (${(performance.now() - startTime).toFixed(2)}ms)`
    : ''
  console.log(`[PERF] ${timestamp} - ${message}${duration}`)
}

// Set up RWJS_CWD.
let original_RWJS_CWD: string | undefined

let createServer: typeof tCreateServer

beforeAll(async () => {
  original_RWJS_CWD = process.env.RWJS_CWD
  process.env.RWJS_CWD = path.join(__dirname, './fixtures/graphql/cedar-app')
  createServer = (await import('../createServer.js')).createServer
})

afterAll(() => {
  process.env.RWJS_CWD = original_RWJS_CWD
})

let consoleWarnSpy: MockInstance<typeof console.warn>
let consoleLogSpy: MockInstance<typeof console.log>

describe('createServer', () => {
  // Create a server for most tests. Some that test initialization create their own
  let server: Awaited<ReturnType<typeof createServer>>

  beforeAll(async () => {
    const startTime = performance.now()
    perfLog('beforeAll: Starting server creation')

    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    perfLog('beforeAll: Console spies set up, creating server')
    server = await createServer()

    perfLog('beforeAll: Server creation complete', startTime)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  afterAll(async () => {
    const startTime = performance.now()
    perfLog('afterAll: Starting cleanup')

    if (server) {
      perfLog('afterAll: Closing server')
      await server.close()
      perfLog('afterAll: Server closed')
    }

    vi.mocked(console.log).mockRestore()
    vi.mocked(console.warn).mockRestore()

    perfLog('afterAll: Cleanup complete', startTime)
  })

  it('serves functions', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/hello',
    })

    expect(res.json()).toEqual({ data: 'hello function' })
  })

  it('warns about server.config.js', async () => {
    await createServer()

    expect(consoleWarnSpy.mock.calls[0][0]).toMatchInlineSnapshot(`
      "[33m[39m
      [33mIgnoring \`config\` and \`configureServer\` in api/server.config.js.[39m
      [33mMigrate them to api/src/server.{ts,js}:[39m
      [33m[39m
      [33m\`\`\`js title="api/src/server.{ts,js}"[39m
      [33m// Pass your config to \`createServer\`[39m
      [33mconst server = createServer({[39m
      [33m  fastifyServerOptions: myFastifyConfig[39m
      [33m})[39m
      [33m[39m
      [33m// Then inline your \`configureFastify\` logic:[39m
      [33mserver.register(myFastifyPlugin)[39m
      [33m\`\`\`[39m
      [33m[39m"
    `)
  })

  it('`apiRootPath` prefixes all routes', async () => {
    const server = await createServer({ apiRootPath: '/api' })

    const res = await server.inject({
      method: 'GET',
      url: '/api/hello',
    })

    expect(res.json()).toEqual({ data: 'hello function' })

    await server.close()
  })

  // We use `console.log` and `.warn` to output some things.
  // Meanwhile, the server gets a logger that may not output to the same place.
  // The server's logger also seems to output things out of order.
  //
  // This should be fixed so that all logs go to the same place
  it("doesn't handle logs consistently", async () => {
    const testStartTime = performance.now()
    perfLog('logs test: Starting')

    // Here we create a logger that outputs to an array.
    const loggerLogs: Record<string, Record<string, string> | string>[] = []
    const stream = build(async (source) => {
      for await (const obj of source) {
        loggerLogs.push(obj)
      }
    })
    const logger = pino(stream)

    // Generate some logs.
    perfLog('logs test: Creating server with custom logger')
    const server = await createServer({ logger })
    perfLog('logs test: Server created, making request')

    const res = await server.inject({
      method: 'GET',
      url: '/hello',
    })
    expect(res.json()).toEqual({ data: 'hello function' })

    perfLog('logs test: Request completed, starting server listen')
    await server.listen({ port: 8910 })
    perfLog('logs test: Server listening, closing server')
    await server.close()
    perfLog('logs test: Server closed', testStartTime)

    // We expect console log to be called with `withFunctions` logs.
    expect(consoleLogSpy.mock.calls[0][0]).toMatch(/Importing Server Functions/)

    const lastCallIndex = consoleLogSpy.mock.calls.length - 1

    expect(consoleLogSpy.mock.calls[lastCallIndex][0]).toMatch(
      /Server listening at/,
    )

    // `console.warn` will be used if there's a `server.config.js` file.
    expect(consoleWarnSpy.mock.calls[0][0]).toMatchInlineSnapshot(`
      "[33m[39m
      [33mIgnoring \`config\` and \`configureServer\` in api/server.config.js.[39m
      [33mMigrate them to api/src/server.{ts,js}:[39m
      [33m[39m
      [33m\`\`\`js title="api/src/server.{ts,js}"[39m
      [33m// Pass your config to \`createServer\`[39m
      [33mconst server = createServer({[39m
      [33m  fastifyServerOptions: myFastifyConfig[39m
      [33m})[39m
      [33m[39m
      [33m// Then inline your \`configureFastify\` logic:[39m
      [33mserver.register(myFastifyPlugin)[39m
      [33m\`\`\`[39m
      [33m[39m"
    `)

    // Finally, the logger. Notice how the request/response logs come before the "server is listening..." logs.
    expect(loggerLogs[0]).toMatchObject({
      reqId: 'req-1',
      level: 30,
      msg: 'incoming request',
      req: {
        method: 'GET',
        remoteAddress: '127.0.0.1',
        url: '/hello',
      },
    })
    expect(loggerLogs[1]).toMatchObject({
      reqId: 'req-1',
      level: 30,
      msg: 'request completed',
      res: {
        statusCode: 200,
      },
    })

    // There will be two lines saying what address the server is listening to,
    // one IPv4 and one IPv6. But after a recent OS update the order of the
    // logs switched. So now I just check that they're there, but don't care
    // what order they're in
    expect(loggerLogs[2]).toMatchObject({
      level: 30,
      msg: /Server listening at http:\/\/(127\.0\.0\.1|\[::1\]):8910/,
    })
    expect(loggerLogs[3]).toMatchObject({
      level: 30,
      msg: /Server listening at http:\/\/(127\.0\.0\.1|\[::1\]):8910/,
    })

    expect(loggerLogs[2].msg).not.toEqual(loggerLogs[3].msg)
  })

  describe('`server.start`', () => {
    it('starts the server using [api].port in redwood.toml if none is specified', async () => {
      const testStartTime = performance.now()
      perfLog('server.start test: Starting')

      const server = await createServer()
      perfLog('server.start test: Server created, starting server')
      await server.start()
      perfLog('server.start test: Server started, checking address')

      const address = server.server.address()

      if (!address || typeof address === 'string') {
        throw new Error('No address or address is a string')
      }

      expect(address.port).toBe(getConfig().api.port)

      perfLog('server.start test: Closing server')
      await server.close()
      perfLog('server.start test: Complete', testStartTime)
    })

    it('the `REDWOOD_API_PORT` env var takes precedence over [api].port', async () => {
      const testStartTime = performance.now()
      perfLog('REDWOOD_API_PORT test: Starting')

      process.env.REDWOOD_API_PORT = '8920'

      perfLog('REDWOOD_API_PORT test: Creating server')
      const server = await createServer()
      perfLog('REDWOOD_API_PORT test: Server created, starting')
      await server.start()
      perfLog('REDWOOD_API_PORT test: Server started, checking address')

      const address = server.server.address()

      if (!address || typeof address === 'string') {
        throw new Error('No address or address is a string')
      }

      expect(address.port).toBe(+process.env.REDWOOD_API_PORT)

      perfLog('REDWOOD_API_PORT test: Closing server')
      await server.close()

      delete process.env.REDWOOD_API_PORT
      perfLog('REDWOOD_API_PORT test: Complete', testStartTime)
    })
  })
})

describe('resolveOptions', () => {
  it('uses defaults when no arguments are passed', () => {
    const resolvedOptions = resolveOptions()
    const defaults = getDefaultCreateServerOptions()

    expect(resolvedOptions).toEqual({
      apiRootPath: defaults.apiRootPath,
      // Can't really compare functions with toEqual() unless it's the same
      // reference. And when calling `getDefaulCreateServerOptions()` you get a
      // new function, and thus a new reference, each time
      configureApiServer: resolvedOptions.configureApiServer,
      fastifyServerOptions: {
        requestTimeout: defaults.fastifyServerOptions.requestTimeout,
        logger: defaults.logger,
        bodyLimit: defaults.fastifyServerOptions.bodyLimit,
      },
      discoverFunctionsGlob: defaults.discoverFunctionsGlob,
      apiHost: defaults.apiHost,
      apiPort: defaults.apiPort,
    })

    expect(resolvedOptions.configureApiServer.toString()).toEqual(
      defaults.configureApiServer.toString(),
    )
  })

  it('ensures `apiRootPath` has slashes', () => {
    const expected = '/v1/'

    expect(
      resolveOptions({
        apiRootPath: 'v1',
      }).apiRootPath,
    ).toEqual(expected)

    expect(
      resolveOptions({
        apiRootPath: '/v1',
      }).apiRootPath,
    ).toEqual(expected)

    expect(
      resolveOptions({
        apiRootPath: 'v1/',
      }).apiRootPath,
    ).toEqual(expected)
  })

  it('moves `logger` to `fastifyServerOptions.logger`', () => {
    const resolvedOptions = resolveOptions({
      logger: { level: 'info' },
    })

    expect(resolvedOptions).toMatchObject({
      fastifyServerOptions: {
        logger: { level: 'info' },
      },
    })
  })

  it('`logger` overwrites `fastifyServerOptions.logger`', () => {
    const resolvedOptions = resolveOptions({
      logger: false,
      fastifyServerOptions: {
        // @ts-expect-error this is invalid TS but valid JS
        logger: true,
      },
    })

    expect(resolvedOptions).toMatchObject({
      fastifyServerOptions: {
        logger: false,
      },
    })
  })

  it('`DEFAULT_CREATE_SERVER_OPTIONS` overwrites `fastifyServerOptions.logger`', () => {
    const resolvedOptions = resolveOptions({
      fastifyServerOptions: {
        // @ts-expect-error this is invalid TS but valid JS
        logger: true,
      },
    })

    expect(resolvedOptions).toMatchObject({
      fastifyServerOptions: {
        logger: getDefaultCreateServerOptions().logger,
      },
    })
  })

  it('parses `--apiPort`', () => {
    expect(
      resolveOptions({ parseArgs: true }, ['--apiPort', '8930']).apiPort,
    ).toEqual(8930)
  })

  it("throws if `--apiPort` can't be converted to an integer", () => {
    expect(() => {
      resolveOptions({ parseArgs: true }, ['--apiPort', 'eight-nine-ten'])
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: \`apiPort\` must be an integer]`,
    )
  })

  it('parses `--apiRootPath`', () => {
    expect(
      resolveOptions({ parseArgs: true }, ['--apiRootPath', 'foo']).apiRootPath,
    ).toEqual('/foo/')
  })

  it('the `--apiRootPath` flag has precedence', () => {
    expect(
      resolveOptions({ parseArgs: true, apiRootPath: 'foo' }, [
        '--apiRootPath',
        'bar',
      ]).apiRootPath,
    ).toEqual('/bar/')
  })

  it('parses `--apiHost`', () => {
    expect(
      resolveOptions({ parseArgs: true }, ['--apiHost', '127.0.0.1']).apiHost,
    ).toEqual('127.0.0.1')
  })
})
