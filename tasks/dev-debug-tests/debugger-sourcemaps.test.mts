import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { cedar } from './vitest.setup.mjs'

const WEB_PORT = 8910
const DEBUG_PORT = 18_911

function fixturePath() {
  return process.env.CEDAR_CWD!
}

function killPort(port: number) {
  try {
    const pid = execSync(`lsof -ti :${port} -P -n 2>/dev/null`, {
      encoding: 'utf-8',
    }).trim()

    if (pid) {
      process.kill(parseInt(pid), 'SIGKILL')
    }
  } catch {
    // port was free
  }
}

describe('debugger sourcemaps', () => {
  it('breakpoints hit correct lines in API functions', async () => {
    killPort(DEBUG_PORT)

    let devProcess: ChildProcess | null = null
    let ws: WebSocket | null = null

    try {
      devProcess = spawn(
        'yarn',
        [
          'node',
          cedar,
          'dev',
          '--ud',
          '--debugBrk',
          `--apiDebugPort=${DEBUG_PORT}`,
          '--fwd=--open=false',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, NODE_OPTIONS: '', FORCE_COLOR: '0' },
        },
      )

      let devOutput = ''
      devProcess.stdout!.on('data', (d) => (devOutput += d.toString()))
      devProcess.stderr!.on('data', (d) => (devOutput += d.toString()))

      devProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.log(`Dev server exited with code ${code}`)
        }
      })

      // Wait for inspector WebSocket URL
      const wsUrl = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 15_000)
        const pattern = new RegExp(`ws://127\\.0\\.0\\.1:${DEBUG_PORT}[^\\s]*`)
        const check = (data: Buffer) => {
          const text = data.toString()
          const m = text.match(pattern)

          if (m) {
            clearTimeout(timer)
            resolve(m[0].trim())
          }
        }

        devProcess!.stdout!.on('data', check)
        devProcess!.stderr!.on('data', check)
      })

      expect(wsUrl, 'Inspector WebSocket URL should be emitted').not.toBeNull()

      const helloPath = resolve(
        fixturePath(),
        'api/src/functions/hello/hello.ts',
      )

      // Connect via CDP
      let msgId = 0
      const pending = new Map<number, (msg: any) => void>()
      const events: any[] = []

      ws = new WebSocket(wsUrl!)
      await new Promise<void>((res, rej) => {
        ws?.on('open', () => res())
        ws?.on('error', rej)
        setTimeout(() => rej(new Error('WebSocket connect timeout')), 5000)
      })

      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString())

        if (msg.id !== undefined) {
          pending.get(msg.id)?.(msg)
          pending.delete(msg.id)
        } else {
          events.push(msg)
        }
      })

      const send = (method: string, params = {}) =>
        new Promise<any>((resolve) => {
          const id = ++msgId
          pending.set(id, resolve)
          ws!.send(JSON.stringify({ id, method, params }))
        })

      // Enable debugger and resume
      await send('Debugger.enable')
      await send('Runtime.enable')
      await send('Runtime.runIfWaitingForDebugger')

      // Wait for hello.ts to be parsed by Vite
      const scriptEvent = await (async () => {
        const start = Date.now()
        while (Date.now() - start < 30_000) {
          const event = events.find(
            (e) =>
              e.method === 'Debugger.scriptParsed' &&
              e.params.url === helloPath,
          )

          if (event) {
            return event
          }

          await sleep(100)
        }

        return null
      })()

      expect(scriptEvent, 'hello.ts script should be parsed').not.toBeNull()

      // Set breakpoint at hello.ts:2 (const n = 5)
      const bpResult = await send('Debugger.setBreakpointByUrl', {
        lineNumber: 1,
        url: helloPath,
        columnNumber: 0,
        condition: '',
      })

      expect(bpResult?.result?.breakpointId).toBeTruthy()
      if (bpResult?.result?.locations?.length) {
        expect(bpResult.result.locations.length).toBeGreaterThan(0)
      }

      // Make HTTP request that triggers the handler
      const httpPromise = fetch(
        `http://localhost:${WEB_PORT}/.api/functions/hello`,
      )

      // Wait for breakpoint hit
      let paused: any = null
      for (let i = 0; i < 100; i++) {
        await sleep(100)

        paused = events.find((e) => e.method === 'Debugger.paused')

        if (paused) {
          break
        }
      }

      expect(paused, 'Breakpoint should be hit').toBeTruthy()

      const frame = paused!.params.callFrames?.[0]
      expect(frame?.url).toBe(helloPath)
      expect(frame?.location?.lineNumber).toBe(1)

      // Verify local scope is accessible
      const localScope = paused!.params.callFrames?.[0]?.scopeChain?.find(
        (s: any) => s.type === 'local',
      )
      expect(localScope).toBeTruthy()

      // Resume execution
      await send('Debugger.resume')

      // Verify HTTP response
      const resp = await httpPromise
      const body = await resp.json()
      expect(resp.status).toBe(200)
      expect(body.data).toContain('hello')
    } finally {
      ws?.close()
      devProcess?.kill('SIGKILL')
      killPort(DEBUG_PORT)
    }
  })
})
