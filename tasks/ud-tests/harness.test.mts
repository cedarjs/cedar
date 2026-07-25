import net from 'node:net'

import { describe, expect, it } from 'vitest'
import { $, ps } from 'zx'

import { reservePort, stopProcess } from './vitest.setup.mjs'

/** `signal 0` checks for the process's existence without touching it */
function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(condition: () => boolean, timeout = 5_000) {
  const start = Date.now()

  while (!condition() && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * Covers the bits of the harness the UD server tests rely on but can't
 * demonstrate themselves - a real server that hangs on SIGTERM is exactly the
 * situation we don't want to have to reproduce to know this works.
 */

/** A process that installs a SIGTERM handler doing nothing, so SIGTERM is ignored */
function spawnUnkillableBySigterm() {
  return $`node -e ${"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"}`
}

function spawnNormal() {
  return $`node -e ${'setInterval(() => {}, 1000)'}`
}

describe('reservePort', () => {
  it('hands out distinct, bindable ports', async () => {
    const ports = await Promise.all([
      reservePort(),
      reservePort(),
      reservePort(),
    ])

    expect(new Set(ports).size).toBe(3)

    // Each one should actually be free right now
    for (const port of ports) {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer()
        server.on('error', reject)
        server.listen(port, '127.0.0.1', () => server.close(() => resolve()))
      })
    }
  })
})

describe('stopProcess', () => {
  it('stops a process that honours SIGTERM', async () => {
    const p = spawnNormal()
    // Give the child time to actually start before signalling it
    await new Promise((resolve) => setTimeout(resolve, 500))

    const start = Date.now()
    await stopProcess(p)

    expect(Date.now() - start).toBeLessThan(4_000)
  }, 15_000)

  it('escalates to SIGKILL for a process that ignores SIGTERM', async () => {
    const p = spawnUnkillableBySigterm()
    await new Promise((resolve) => setTimeout(resolve, 500))

    // The server itself is a grandchild - zx spawns through a shell - and it is
    // the one holding the ports, so it is the one that has to die.
    const descendants = await ps.tree({ pid: p.pid, recursive: true })
    expect(descendants.length).toBeGreaterThan(0)

    const start = Date.now()
    // A short grace period keeps the test quick; the escalation is the point
    await stopProcess(p, 750)
    const elapsed = Date.now() - start

    // It had to wait out the grace period before escalating
    expect(elapsed).toBeGreaterThanOrEqual(700)
    expect(elapsed).toBeLessThan(10_000)

    // Assert the processes are really gone rather than trusting zx's promise,
    // which settles on stdio close and can lag behind the actual exits.
    // Polled, because reaping a SIGKILLed process isn't instantaneous.
    const pids = [...descendants.map((d) => Number(d.pid)), p.pid]
    await waitFor(() => pids.every((pid) => !isAlive(pid)))

    for (const pid of pids) {
      expect(isAlive(pid)).toBe(false)
    }
  }, 20_000)

  it('is a no-op for a process that has already exited', async () => {
    const p = $`node -e ${'process.exit(0)'}`
    await p.catch(() => undefined)

    await expect(stopProcess(p)).resolves.toBeUndefined()
  }, 15_000)
})
