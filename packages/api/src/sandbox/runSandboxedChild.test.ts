import dgram from 'node:dgram'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { permissionModelBlocksNetwork } from './noNetworkPreload.js'
import { runSandboxedChild, sandboxedChildArgs } from './runSandboxedChild.js'

// What a crafted input that took over the parser in the child could try to
// reach. Each probe is a small script run exactly as an app's child script
// would be.

let tmp: string
let scripts: string

const writeScript = (name: string, code: string) => {
  const file = path.join(scripts, name)
  fs.writeFileSync(file, code)
  return file
}

const probe = (
  code: string,
  options: Partial<Parameters<typeof runSandboxedChild>[0]> = {},
) =>
  runSandboxedChild({
    script: writeScript(
      `probe-${Math.random().toString(36).slice(2)}.mjs`,
      code,
    ),
    input: Buffer.alloc(0),
    ...options,
  })

beforeAll(() => {
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-sandbox-')),
  )
  scripts = path.join(tmp, 'scripts')
  fs.mkdirSync(scripts)
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/**
 * Tries every way from JavaScript to the network, and prints what each got.
 * The last one, if it isn't refused, crashes the child (Node asserts on the
 * fake connect request), which fails the test loudly too.
 */
const NETWORK_PROBE = `
import { createRequire } from 'node:module'

const [port, socketPath, udpPort] = process.argv.slice(2)
const require = createRequire(import.meta.url)
const routes = {}
// Some refusals are thrown asynchronously (on Node 25+, listen() throws on
// the next tick), so an uncaught exception counts as the attempt's error
const attempt = async (name, fn) => {
  let onUncaught
  try {
    const got = await new Promise((resolve, reject) => {
      onUncaught = reject
      process.once('uncaughtException', onUncaught)
      Promise.resolve().then(fn).then(resolve, reject)
    })
    routes[name] = 'ALLOWED: ' + got
  } catch (e) {
    routes[name] = 'refused: ' + (e.code ?? e.message)
  } finally {
    process.off('uncaughtException', onUncaught)
  }
}
const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.on('connect', () => resolve('connected'))
    socket.on('error', reject)
  })

await attempt('tcp', async () =>
  connected((await import('node:net')).connect(Number(port), '127.0.0.1')))
await attempt('unix socket', async () =>
  connected((await import('node:net')).connect(socketPath)))
await attempt('getBuiltinModule', async () =>
  connected(process.getBuiltinModule('node:net').connect(Number(port), '127.0.0.1')))
await attempt('require http', () =>
  new Promise((resolve, reject) => {
    require('http')
      .get('http://127.0.0.1:' + port + '/', (res) => resolve(res.statusCode))
      .on('error', reject)
  }))
await attempt('require tls', () =>
  connected(require('node:tls').connect(Number(port), '127.0.0.1')))
await attempt('fetch', async () =>
  (await fetch('http://127.0.0.1:' + port + '/')).status)
await attempt('WebSocket', () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/')
    ws.onopen = () => resolve('open')
    ws.onerror = () => reject(new Error('error event'))
  }))
await attempt('udp', async () => {
  const socket = (await import('node:dgram')).createSocket('udp4')
  await new Promise((resolve, reject) => {
    socket.on('error', reject)
    socket.send('hello', Number(udpPort), '127.0.0.1', (e) => (e ? reject(e) : resolve()))
  })
  return 'sent'
})
await attempt('dns', async () =>
  (await (await import('node:dns/promises')).lookup('localhost')).address)
await attempt('listen', () =>
  new Promise((resolve, reject) => {
    const server = require('node:net').createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve('listening'))
  }))
await attempt('stdout socket', async () =>
  connected(new process.stdout.constructor().connect(Number(port), '127.0.0.1')))
await attempt('process.binding', async () => typeof process.binding('tcp_wrap'))
await attempt('stdout handle', async () => {
  const Handle = process.stdout._handle.constructor
  // Returns an error (or a negative error number) when refused
  const err = new Handle(0).connect({}, socketPath)
  if (err) {
    throw typeof err === 'object' ? err : new Error('connect returned ' + err)
  }
  return 'connecting'
})

process.stdout.write(JSON.stringify(routes))
`

const NETWORK_ROUTES = [
  'tcp',
  'unix socket',
  'getBuiltinModule',
  'require http',
  'require tls',
  'fetch',
  'WebSocket',
  'udp',
  'dns',
  'listen',
  'stdout socket',
  'process.binding',
  'stdout handle',
]

const WINDOWS_REQUIRED_VARS = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]

describe('runSandboxedChild', () => {
  it('sends the input on stdin and returns stdout, byte for byte', async () => {
    const input = Buffer.from([0, 1, 2, 255, 254, 10, 13, 0])

    const result = await probe(
      `const chunks = []
       for await (const chunk of process.stdin) chunks.push(chunk)
       process.stdout.write(Buffer.concat(chunks).reverse())`,
      { input },
    )

    expect(result).toMatchObject({ ok: true })
    expect(result.ok && [...result.output]).toEqual([...input].reverse())
  })

  it('passes args to the script', async () => {
    const result = await probe(
      `process.stdout.write(JSON.stringify(process.argv.slice(2)))`,
      { args: ['centre', '328,164'] },
    )

    expect(result.ok && result.output.toString()).toBe('["centre","328,164"]')
  })

  it('gives the child none of the parent environment', async () => {
    process.env.CEDAR_SANDBOX_TEST_SECRET = 'hunter2'
    try {
      const result = await probe(
        `process.stdout.write(JSON.stringify(process.env))`,
      )

      expect(result.ok).toBe(true)
      const env: Record<string, string> = JSON.parse(
        result.ok ? result.output.toString() : '{}',
      )
      // macOS adds __CF_USER_TEXT_ENCODING to every process, and on Windows
      // libuv always passes on these system variables (its `required_vars`),
      // whatever env it's given. Nothing else may be there
      const keys = Object.keys(env).filter(
        (k) =>
          !k.startsWith('__CF') &&
          !(
            process.platform === 'win32' &&
            WINDOWS_REQUIRED_VARS.includes(k.toUpperCase())
          ),
      )
      expect(keys).toEqual([])
      expect(JSON.stringify(env)).not.toContain('hunter2')
    } finally {
      delete process.env.CEDAR_SANDBOX_TEST_SECRET
    }
  })

  it('may read the paths it is given, and nothing else', async () => {
    const allowedDir = path.join(tmp, 'allowed')
    fs.mkdirSync(allowedDir, { recursive: true })
    fs.writeFileSync(path.join(allowedDir, 'data.txt'), 'allowed')
    const secret = path.join(tmp, '.env')
    fs.writeFileSync(secret, 'DATABASE_URL=postgres://secret')

    const allowed = await probe(
      `import fs from 'node:fs'
       process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(allowedDir, 'data.txt'))}))`,
      { readable: [allowedDir] },
    )
    expect(allowed.ok && allowed.output.toString()).toBe('allowed')

    const refused = await probe(
      `import fs from 'node:fs'
       process.stdout.write(fs.readFileSync(${JSON.stringify(secret)}))`,
      { readable: [allowedDir] },
    )
    expect(refused).toMatchObject({ ok: false, failure: 'exit' })
    expect(!refused.ok && refused.stderr).toContain(
      "permission: 'FileSystemRead'",
    )
    expect(refused.ok || refused.stderr).not.toContain('postgres://secret')

    // Not even the folder its own script is in
    const sibling = await probe(
      `import fs from 'node:fs'
       fs.readdirSync(${JSON.stringify(scripts)})`,
    )
    expect(!sibling.ok && sibling.stderr).toContain(
      "permission: 'FileSystemRead'",
    )
  })

  it('may not write files', async () => {
    const target = path.join(tmp, 'written.txt')

    const result = await probe(
      `import fs from 'node:fs'
       fs.writeFileSync(${JSON.stringify(target)}, 'x')`,
    )

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain(
      "permission: 'FileSystemWrite'",
    )
    expect(fs.existsSync(target)).toBe(false)
  })

  it('may not start processes', async () => {
    const result = await probe(
      `import { spawnSync } from 'node:child_process'
       spawnSync(process.execPath, ['-e', ''])`,
    )

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain("permission: 'ChildProcess'")
  })

  it('may not start worker threads', async () => {
    const result = await probe(
      `import { Worker } from 'node:worker_threads'
       new Worker('process.exit(0)', { eval: true })`,
    )

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain("permission: 'WorkerThreads'")
  })

  it('may not generate code from strings', async () => {
    const result = await probe(`new Function('return 1')()`)

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain('EvalError')
  })

  it('may not load native addons unless allowed', async () => {
    const result = await probe(
      `process.dlopen({ exports: {} }, ${JSON.stringify(path.join(tmp, 'addon.node'))})`,
    )

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain('ERR_DLOPEN_DISABLED')
  })

  it('may not reach the network, by any route', async () => {
    // Servers in the parent, standing in for anything on the network the
    // server can reach: a database on a port or a Unix socket, a cloud
    // metadata endpoint
    let connections = 0
    const count = () => {
      connections += 1
    }
    const tcp = net.createServer((socket) => {
      count()
      socket.end('HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n')
    })
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
    const tcpAddress = tcp.address()
    const port =
      typeof tcpAddress === 'object' && tcpAddress ? tcpAddress.port : 0

    // Short: macOS caps a Unix socket's path at about 100 characters
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cedar-sandbox-${process.pid}`
        : `/tmp/cedar-sandbox-${process.pid}.sock`
    if (process.platform !== 'win32') {
      fs.rmSync(socketPath, { force: true })
    }
    const unix = net.createServer((socket) => {
      count()
      socket.end()
    })
    await new Promise<void>((resolve) => unix.listen(socketPath, resolve))

    const udp = dgram.createSocket('udp4')
    udp.on('message', count)
    await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', resolve))
    const udpPort = udp.address().port

    try {
      const result = await probe(NETWORK_PROBE, {
        args: [String(port), socketPath, String(udpPort)],
        nodeModulesFrom: false,
      })

      expect(result.ok ? '' : result.stderr).toBe('')
      const routes: Record<string, string> = JSON.parse(
        result.ok ? result.output.toString() : '{}',
      )
      expect(Object.keys(routes)).toEqual(NETWORK_ROUTES)
      for (const [route, got] of Object.entries(routes)) {
        expect({ route, got }).toEqual({
          route,
          got: expect.stringMatching(/^refused: /),
        })
      }

      // Give anything that did get through time to arrive
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(connections).toBe(0)
    } finally {
      await new Promise((resolve) => tcp.close(resolve))
      await new Promise((resolve) => unix.close(resolve))
      await new Promise<void>((resolve) => udp.close(() => resolve()))
    }
  })

  it('kills the child at the timeout', async () => {
    const started = Date.now()

    const result = await probe(`setInterval(() => {}, 1000)`, {
      timeoutMs: 300,
    })

    expect(result).toMatchObject({ ok: false, failure: 'timeout' })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('kills the child as soon as its output is over the cap', async () => {
    const result = await probe(
      `process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 1))
       setInterval(() => {}, 1000)`,
      { maxOutputBytes: 1024 * 1024, timeoutMs: 10_000 },
    )

    expect(result).toMatchObject({ ok: false, failure: 'output-too-large' })
  })

  it('refuses input over the cap without starting a child', async () => {
    const result = await probe(`process.exit(0)`, {
      input: Buffer.alloc(11),
      maxInputBytes: 10,
    })

    expect(result).toMatchObject({
      ok: false,
      failure: 'input-too-large',
      exitCode: null,
      signal: null,
    })
  })

  it('fails when the child runs out of heap', async () => {
    const result = await probe(
      `const keep = []
       for (;;) keep.push(new Array(1e6).fill(Math.random()))`,
      { heapMb: 32, timeoutMs: 20_000 },
    )

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
  })

  it("reports a failed child's last stderr line and exit code", async () => {
    const result = await probe(
      `console.error('warming up')
       console.error('not a PNG')
       process.exit(3)`,
    )

    expect(result).toMatchObject({
      ok: false,
      failure: 'exit',
      exitCode: 3,
      message: 'exited with 3: not a PNG',
    })
  })

  it('is a failure, not a rejection, when the script is missing', async () => {
    const result = await runSandboxedChild({
      script: path.join(tmp, 'missing.mjs'),
      input: Buffer.alloc(1),
    })

    expect(result).toMatchObject({ ok: false, failure: 'spawn-error' })
  })
})

describe('sandboxedChildArgs', () => {
  it('locks the child down, and resolves symlinks', () => {
    const real = path.join(tmp, 'releases', 'v1')
    fs.mkdirSync(path.join(real, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(real, 'child.mjs'), '')
    const current = path.join(tmp, 'current')
    fs.symlinkSync(real, current, 'junction')
    const data = path.join(tmp, 'data')
    fs.mkdirSync(data)

    const args = sandboxedChildArgs({
      script: path.join(current, 'child.mjs'),
      readable: [data],
      heapMb: 64,
      args: ['x'],
    })

    const preload = args.filter((arg) => arg.startsWith('--import=data:'))
    expect(args.filter((arg) => !preload.includes(arg))).toEqual([
      '--max-old-space-size=64',
      '--disallow-code-generation-from-strings',
      '--permission',
      '--no-warnings',
      `--allow-fs-read=${path.join(real, 'child.mjs')}`,
      // The node_modules next to the script, not the folder it's in
      `--allow-fs-read=${path.join(real, 'node_modules')}`,
      `--allow-fs-read=${data}`,
      path.join(real, 'child.mjs'),
      'x',
    ])
    // The no-network preload, before the script, when Node's permission
    // model doesn't block the network itself
    expect(preload).toHaveLength(permissionModelBlocksNetwork() ? 0 : 1)
    expect(args.indexOf(preload[0])).toBe(
      permissionModelBlocksNetwork() ? -1 : args.length - 3,
    )

    expect(
      sandboxedChildArgs({
        script: path.join(real, 'child.mjs'),
        allowAddons: true,
      }),
    ).toContain('--allow-addons')
    expect(
      sandboxedChildArgs({
        script: path.join(real, 'child.mjs'),
        nodeModulesFrom: false,
      }),
    ).not.toContain(`--allow-fs-read=${path.join(real, 'node_modules')}`)
  })
})
