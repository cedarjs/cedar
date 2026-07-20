import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { fs, path, $ } from 'zx'

import {
  FIXTURE_PATH,
  pollForReady,
  sleep,
  testContext,
} from './vitest.setup.mjs'

const WEB_PORT = 18910
const BASE_URL = `http://localhost:${WEB_PORT}`

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

// Resolve the cedar-unified-dev binary path directly instead of going through
// `cedar dev --ud`. The CLI adds orchestration steps that the fixture can't
// satisfy (Prisma generation, yarn workspace resolution via concurrently)
// because it has an empty yarn.lock, no node_modules, and no Prisma schema.
// Running cedar-unified-dev directly isolates the test to just the dev server
// behaviour, which is what we want to test here.
// Note: even though the CLI is launched from the monorepo root, concurrently
// overrides cwd to the fixture (cedarPaths.web.base), so yarn resolves against
// the fixture's empty lockfile rather than the monorepo's.
function resolveUnifiedDevBin() {
  const vitePackagePath = path.resolve(
    import.meta.dirname,
    '../../packages/vite',
  )
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(vitePackagePath, 'package.json'), 'utf-8'),
  )
  return path.resolve(vitePackagePath, packageJson.bin['cedar-unified-dev'])
}

describe('cedar dev --ud', () => {
  it('serves the web SPA shell and API routes with HMR', async () => {
    // 1. Start the unified dev server directly
    const unifiedDevBin = resolveUnifiedDevBin()
    const devProcess = $`yarn node ${unifiedDevBin} --port ${WEB_PORT} --apiPort 18911 --no-open`
    testContext.processes.push(devProcess)

    // 2. Wait for the web server to be ready
    await pollForReady(`${BASE_URL}/`)

    // 3. Web route should return the SPA shell
    const webRes = await fetch(`${BASE_URL}/`)
    expect(webRes.status).toEqual(200)
    const webText = await webRes.text()
    expect(webText).toContain('<div id="cedar-app">')
    expect(webText).toContain('<script type="module"')

    // 4. Native handleRequest function
    const helloRes = await fetchJson(`${BASE_URL}/.api/functions/hello`)
    expect(helloRes.status).toEqual(200)
    expect(helloRes.body).toEqual({ data: 'hello from cedar' })

    // 5. Legacy handler function (wrapped automatically)
    const legacyRes = await fetchJson(`${BASE_URL}/.api/functions/legacyHello`)
    expect(legacyRes.status).toEqual(200)
    expect(legacyRes.body).toEqual({ data: 'hello from legacy handler' })

    // 6. GraphQL endpoint
    const gqlRes = await fetchJson(`${BASE_URL}/.api/functions/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ hello }' }),
    })
    expect(gqlRes.status).toEqual(200)
    expect(gqlRes.body).toMatchObject({
      data: { hello: 'Hello from Cedar GraphQL' },
    })

    // 7. HMR: modify the API function source and expect the change to be reflected
    const helloSrcPath = `${FIXTURE_PATH}/api/src/functions/hello.ts`
    const originalSrc = fs.readFileSync(helloSrcPath, 'utf-8')
    const updatedSrc = originalSrc.replace(
      'hello from cedar',
      'hello from cedar (updated)',
    )

    fs.writeFileSync(helloSrcPath, updatedSrc)

    try {
      // Poll until the updated response is returned (or timeout)
      let updated = false
      for (let i = 0; i < 40; i++) {
        await sleep(250)
        const res = await fetchJson(`${BASE_URL}/.api/functions/hello`)
        if (
          res.status === 200 &&
          res.body?.data === 'hello from cedar (updated)'
        ) {
          updated = true
          break
        }
      }
      expect(updated).toEqual(true)
    } finally {
      // Always restore the original source
      fs.writeFileSync(helloSrcPath, originalSrc)
    }
  }, 60_000)

  it('pretty-prints the api logger output instead of printing raw pino NDJSON', async () => {
    const unifiedDevBin = resolveUnifiedDevBin()
    // The api logger defaults to `silent` when NODE_ENV=test (see
    // packages/api/src/logger/index.ts), which vitest sets and this
    // process inherits — force a level that actually emits the
    // graphql-server plugin's debug-level request logs this test checks for.
    const devProcess = $({
      env: { ...process.env, LOG_LEVEL: 'debug' },
    })`yarn node ${unifiedDevBin} --port ${WEB_PORT} --apiPort 18911 --no-open`
    testContext.processes.push(devProcess)

    let stdoutBuffer = ''
    devProcess.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
    })

    await pollForReady(`${BASE_URL}/`)

    const gqlRes = await fetchJson(`${BASE_URL}/.api/functions/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ hello }' }),
    })
    expect(gqlRes.status).toEqual(200)

    // Wait for the request's log lines to appear rather than a flat sleep,
    // since flushing to stdout isn't synchronous with the response
    for (let i = 0; i < 20; i++) {
      if (stdoutBuffer.includes('🐛')) {
        break
      }
      await sleep(250)
    }

    // The graphql-server request-logging plugin (useRedwoodLogger) logs
    // through the api's pino logger on every request. Under `--ud`, that
    // logger's destination is swapped for a formatting one (see
    // packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts) —
    // so its output should look like cedar-log-formatter's pretty-printed
    // format (emoji log-level markers, HH:mm:ss timestamps), not raw pino
    // NDJSON.
    expect(stdoutBuffer).toContain('🐛')
    expect(stdoutBuffer).not.toContain('"level":20')
    expect(stdoutBuffer).not.toMatch(/\{"level":\d+,"time":\d+/)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// CDP (Chrome DevTools Protocol) helper
// ---------------------------------------------------------------------------

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(
    event: string,
    callback: (params: Record<string, unknown>) => void,
  ): () => void
  close(): void
}

function createCdpSession(
  wsUrl: string,
  opts: { timeout?: number } = {},
): Promise<CdpSession> {
  const { timeout = 5_000 } = opts

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >()
    const listeners = new Map<
      string,
      ((params: Record<string, unknown>) => void)[]
    >()
    let nextId = 1
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        ws.close()
        reject(
          new Error(`CDP connection to ${wsUrl} timed out after ${timeout}ms`),
        )
      }
    }, timeout)

    ws.on('open', () => {
      settled = true
      clearTimeout(timer)
      resolve({
        send(method: string, params?: Record<string, unknown>) {
          return new Promise((res, rej) => {
            const id = nextId++
            pending.set(id, { resolve: res, reject: rej })

            // Safety timeout per-message so a single hung CDP command
            // can't stall the test forever.
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id)
                rej(
                  new Error(
                    `CDP ${method} (id=${id}) timed out after ${timeout}ms`,
                  ),
                )
              }
            }, timeout)

            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        on(event: string, callback: (params: Record<string, unknown>) => void) {
          if (!listeners.has(event)) {
            listeners.set(event, [])
          }
          listeners.get(event)!.push(callback)
          return () => {
            const cbs = listeners.get(event)
            if (cbs) {
              const idx = cbs.indexOf(callback)
              if (idx !== -1) {
                cbs.splice(idx, 1)
              }
            }
          }
        },
        close() {
          ws.close()
        },
      })
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())

      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) {
          p.reject(new Error(`CDP error: ${msg.error.message}`))
        } else {
          p.resolve(msg.result)
        }
      } else if (msg.method) {
        const cbs = listeners.get(msg.method)
        if (cbs) {
          for (const cb of cbs) {
            cb(msg.params)
          }
        }
      }
    })

    ws.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })

    ws.on('close', () => {
      clearTimeout(timer)
      for (const [, p] of pending) {
        p.reject(new Error('CDP WebSocket closed unexpectedly'))
      }
      pending.clear()
    })
  })
}

// ---------------------------------------------------------------------------
// debug-port integration test
// ---------------------------------------------------------------------------

describe('cedar dev --ud --debug-port', () => {
  it('opens the inspector on the given port, allows CDP interaction, and can pause/resume execution', async () => {
    // Use distinct ports to avoid accidental overlap if tests ever parallelise
    const WEB_PORT = 18920
    const API_PORT = 18921
    const DEBUG_PORT = 38911
    const BASE_URL = `http://localhost:${WEB_PORT}`

    // 1. Start the unified dev server with --debug-port. We pass the flag
    //    directly to cedar-unified-dev (bypassing the CLI) because the fixture
    //    has an empty yarn.lock and no node_modules — see
    //    resolveUnifiedDevBin() above. CEDAR_CWD is set globally by beforeAll
    //    in vitest.setup.mts.
    const unifiedDevBin = resolveUnifiedDevBin()

    let stderrBuffer = ''
    const devProcess = $`yarn node ${unifiedDevBin} --port ${WEB_PORT} --apiPort ${API_PORT} --debug-port ${DEBUG_PORT} --no-open`
    devProcess.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString()
    })
    testContext.processes.push(devProcess)

    // 2. Wait for the inspector message on stderr and verify the port.
    //    inspector.open() logs:  Debugger listening on ws://127.0.0.1:<port>/<uuid>
    const inspectorUrl = await new Promise<string>((resolve, reject) => {
      const inspectorTimeout = 15_000
      const start = Date.now()
      const poll = setInterval(() => {
        const match = stderrBuffer.match(
          /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/,
        )
        if (match) {
          clearInterval(poll)
          resolve(match[1])
        } else if (Date.now() - start > inspectorTimeout) {
          clearInterval(poll)
          reject(
            new Error(
              `Inspector did not start within ${inspectorTimeout}ms. stderr so far:\n${stderrBuffer}`,
            ),
          )
        }
      }, 100)
    })

    const inspectorPort = parseInt(inspectorUrl.match(/:(\d+)\//)![1], 10)
    expect(inspectorPort).toBe(DEBUG_PORT)

    // 3. Wait for the web server to be ready
    await pollForReady(`${BASE_URL}/`)

    // 4. Connect to the inspector via CDP using the full WebSocket URL
    //    (including the UUID path, which the inspector requires — connecting
    //    to ws://host:port without the UUID returns HTTP 400).
    const cdp = await createCdpSession(inspectorUrl, { timeout: 10_000 })

    try {
      // 5. Verify basic CDP messaging works by evaluating a simple expression
      const evalResult = (await cdp.send('Runtime.evaluate', {
        expression: '1 + 1',
      })) as { result?: { value?: unknown } }
      expect(evalResult.result?.value).toBe(2)

      // 6. Enable the debugger so we can pause execution
      await cdp.send('Debugger.enable')

      // 7. Test that the debugger halts on a `debugger;` statement and can
      //    resume. The evaluate response only arrives after we resume.
      let pausedResolve!: (params: Record<string, unknown>) => void
      const pausedOnce = new Promise<Record<string, unknown>>((resolve) => {
        pausedResolve = resolve
      })
      const unsubPause = cdp.on('Debugger.paused', (params) => {
        unsubPause()
        pausedResolve(params)
      })

      const evalPromise = cdp.send('Runtime.evaluate', {
        expression: '(() => { debugger; return 42; })()',
      })

      const paused = await pausedOnce
      expect(paused.reason).toBe('other')
      expect((paused.callFrames as unknown[]).length).toBeGreaterThan(0)

      await cdp.send('Debugger.resume')
      const pausedEvalResult = (await evalPromise) as {
        result?: { value?: unknown }
      }
      expect(pausedEvalResult.result?.value).toBe(42)

      // 8. Test that Debugger.pause() can interrupt a real API request.
      //    Arm the pause BEFORE issuing the request so V8 halts on the next
      //    statement the dev server executes. This is deterministic — it
      //    avoids the race where a trivial handler (hello.ts returns a static
      //    response) completes before the pause is armed, which would leave
      //    the pause pending forever and time out the test.
      let requestPausedResolve!: (params: Record<string, unknown>) => void
      const requestPausedOnce = new Promise<Record<string, unknown>>(
        (resolve) => {
          requestPausedResolve = resolve
        },
      )
      const unsubRequestPause = cdp.on('Debugger.paused', (params) => {
        unsubRequestPause()
        requestPausedResolve(params)
      })

      await cdp.send('Debugger.pause')
      const fetchPromise = fetchJson(`${BASE_URL}/.api/functions/hello`)

      const requestPaused = await requestPausedOnce
      expect(requestPaused.reason).toBeDefined()
      expect((requestPaused.callFrames as unknown[]).length).toBeGreaterThan(0)

      // 9. Resume and verify the HTTP response completes successfully
      await cdp.send('Debugger.resume')
      const helloRes = await fetchPromise
      expect(helloRes.status).toEqual(200)
      expect(helloRes.body).toEqual({ data: 'hello from cedar' })
    } finally {
      cdp.close()
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// debug-brk integration test — early-connect flow
// ---------------------------------------------------------------------------

describe('cedar dev --ud --debug-brk', () => {
  it('blocks the server until a debugger connects, then serves requests normally', async () => {
    // Use distinct ports — no overlap with the other two test blocks
    const WEB_PORT = 18930
    const API_PORT = 18931
    const DEBUG_PORT = 38912
    const BASE_URL = `http://localhost:${WEB_PORT}`

    // 1. Start the unified dev server with --debug-brk.
    //    inspector.open() runs first (logged to stderr), then
    //    inspector.waitForDebugger() blocks.
    const unifiedDevBin = resolveUnifiedDevBin()

    let stderrBuffer = ''
    const devProcess = $`yarn node ${unifiedDevBin} --port ${WEB_PORT} --apiPort ${API_PORT} --debug-port ${DEBUG_PORT} --debug-brk --no-open`
    devProcess.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString()
    })
    testContext.processes.push(devProcess)

    // 2. Wait for the inspector message on stderr.
    const inspectorUrl = await new Promise<string>((resolve, reject) => {
      const inspectorTimeout = 15_000
      const start = Date.now()
      const poll = setInterval(() => {
        const match = stderrBuffer.match(
          /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/,
        )
        if (match) {
          clearInterval(poll)
          resolve(match[1])
        } else if (Date.now() - start > inspectorTimeout) {
          clearInterval(poll)
          reject(
            new Error(
              `Inspector did not start within ${inspectorTimeout}ms. stderr so far:\n${stderrBuffer}`,
            ),
          )
        }
      }, 100)
    })

    expect(inspectorUrl).toContain(`:${DEBUG_PORT}/`)

    // 3. Verify the web server is NOT ready — waitForDebugger is blocking.
    //    pollForReady with a short timeout should throw.
    await expect(
      pollForReady(`${BASE_URL}/`, { timeout: 3_000, interval: 300 }),
    ).rejects.toThrow()

    // 4. Connect to the inspector.  The process is still blocked at
    //    waitForDebugger, so the connection establishes quickly.
    const cdp = await createCdpSession(inspectorUrl, { timeout: 10_000 })

    try {
      // 5. Enable the debugger so we can receive pause/resume events.
      await cdp.send('Debugger.enable')

      // 6. Set up a one-shot listener for the Debugger.paused event.
      //    After waitForDebugger() unblocks, the process creates an
      //    inspector.Session, posts Debugger.pause, and then fires
      //    Runtime.evaluate with a trivial expression to force V8 to
      //    check the pause flag.  This emits Debugger.paused to all
      //    connected sessions.
      let pausedResolve!: () => void
      const pausedPromise = new Promise<void>((resolve) => {
        pausedResolve = resolve
      })
      const unsubPause = cdp.on('Debugger.paused', () => {
        unsubPause()
        pausedResolve()
      })

      // 7. Unblock waitForDebugger().  The process will then:
      //     a) Create a Session, post Debugger.enable + Debugger.pause
      //     b) Post Runtime.evaluate to trigger the pause check
      //     c) Emit Debugger.paused to all sessions
      await cdp.send('Runtime.runIfWaitingForDebugger')

      // 8. Wait for the pause to take effect.
      await pausedPromise

      // 9. Resume execution — the internal Session receives
      //    Debugger.resumed and the process continues to
      //    startApiDevMiddleware().
      await cdp.send('Debugger.resume')

      // 10. The server should now become available.
      await pollForReady(`${BASE_URL}/`)

      // 11. Verify basic CDP messaging works.
      const evalResult = (await cdp.send('Runtime.evaluate', {
        expression: '1 + 1',
      })) as { result?: { value?: unknown } }
      expect(evalResult.result?.value).toBe(2)

      // 12. Verify the API function works.
      const helloRes = await fetchJson(`${BASE_URL}/.api/functions/hello`)
      expect(helloRes.status).toEqual(200)
      expect(helloRes.body).toEqual({ data: 'hello from cedar' })
    } finally {
      cdp.close()
    }
  }, 60_000)
})
