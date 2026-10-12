import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  runSandboxedChild,
  sandboxBlocksNetwork,
  sandboxedChildArgs,
} from './runSandboxedChild.js'

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

  it(
    sandboxBlocksNetwork()
      ? 'may not open network connections'
      : 'may open network connections (this Node has no network permission)',
    async () => {
      // A server in the parent, standing in for anything on the network the
      // server can reach: a database, a cloud metadata endpoint
      const server = net.createServer((socket) => socket.end('hello'))
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      )
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0

      try {
        const result = await probe(
          `import net from 'node:net'
           const socket = net.connect(${port}, '127.0.0.1')
           socket.on('data', (d) => process.stdout.write(d))
           socket.on('error', (e) => { console.error(e.code ?? e.message); process.exit(1) })`,
        )

        if (sandboxBlocksNetwork()) {
          expect(result.ok).toBe(false)
        } else {
          // Documents the gap rather than hiding it: on a Node without
          // network permission the child can connect. When CI's Node gains
          // it, the test above takes over
          expect(result.ok && result.output.toString()).toBe('hello')
        }
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    },
  )

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
    fs.mkdirSync(real, { recursive: true })
    fs.writeFileSync(path.join(real, 'child.mjs'), '')
    const current = path.join(tmp, 'current')
    fs.symlinkSync(real, current, 'junction')

    const args = sandboxedChildArgs({
      script: path.join(current, 'child.mjs'),
      readable: [current],
      heapMb: 64,
      args: ['x'],
    })

    expect(args).toEqual([
      '--max-old-space-size=64',
      '--disallow-code-generation-from-strings',
      '--permission',
      '--no-warnings',
      `--allow-fs-read=${path.join(real, 'child.mjs')}`,
      `--allow-fs-read=${real}`,
      path.join(real, 'child.mjs'),
      'x',
    ])
    expect(
      sandboxedChildArgs({
        script: path.join(real, 'child.mjs'),
        allowAddons: true,
      }),
    ).toContain('--allow-addons')
  })
})
