import net from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, onTestFinished } from 'vitest'
import { fs, path, ps, $ } from 'zx'
import type { ProcessPromise } from 'zx'

import { getConfig } from '@cedarjs/project-config'

$.verbose = !!process.env.VERBOSE

const fixtureUrl = new URL('../../__fixtures__/cedar-ud-app', import.meta.url)
export const FIXTURE_PATH = fileURLToPath(fixtureUrl)

/** How long a server gets to exit on SIGTERM before we escalate to SIGKILL */
const STOP_GRACE_MS = 5_000

/** Resolve the cedar CLI binary from the monorepo */
function resolveCedarBin() {
  const cliPackagePath = path.resolve(import.meta.dirname, '../../packages/cli')
  const packageJsonPath = path.join(cliPackagePath, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const binPath = path.resolve(cliPackagePath, packageJson.bin.cedar)
  return binPath
}

export const cedar = resolveCedarBin()

export const testContext = {
  projectConfig: {} as ReturnType<typeof getConfig>,
}

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = FIXTURE_PATH
  testContext.projectConfig = getConfig()
})

afterAll(() => {
  if (original_CEDAR_CWD === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = original_CEDAR_CWD
  }
})

const reservedPorts = new Set<number>()

/**
 * Reserve a free TCP port.
 *
 * The servers under test run as child processes, so we can't hand them a socket
 * we already hold - we have to pick a number and trust it is still free a
 * moment later. Letting the OS pick an ephemeral port is far safer than
 * hardcoding one, and `reservedPorts` stops us handing the same number to two
 * tests in the same run.
 */
export async function reservePort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer()
      probe.unref()
      probe.on('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        const found = typeof address === 'object' && address ? address.port : 0
        probe.close(() => resolve(found))
      })
    })

    if (port && !reservedPorts.has(port)) {
      reservedPorts.add(port)
      return port
    }
  }

  throw new Error('Could not reserve a free port')
}

/**
 * Every pid we may need to signal, the server itself first.
 *
 * This has to be captured *before* anything is signalled. zx spawns through a
 * shell, so the server is a grandchild; the shell dies on the first SIGTERM,
 * the server gets reparented to init, and from then on walking down from the
 * shell's pid finds nothing. Which means zx can no longer kill the one process
 * that actually holds the ports - so we remember the pids ourselves.
 *
 * ud-tests are Ubuntu-only (see .github/workflows/ud-tests.yml), so plain POSIX
 * signals are enough here - no Windows taskkill path needed.
 */
async function collectPids(p: ProcessPromise) {
  const pids: number[] = []

  // Top-level pid first, so the server is signalled before the children it
  // owns. Signalling its esbuild child first makes the server crash on a
  // "service was stopped: write EPIPE" mid-transform instead of shutting down.
  if (p.pid) {
    pids.push(p.pid)
  }

  try {
    const tree = await ps.tree({ pid: p.pid, recursive: true })
    pids.push(...tree.map((entry) => Number(entry.pid)))
  } catch {
    // Best effort. Without `ps` we can still signal the top-level process.
  }

  return pids.filter((pid) => Number.isInteger(pid) && pid > 0)
}

function signalAll(pids: number[], signal: 'SIGTERM' | 'SIGKILL') {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone
    }
  }
}

function isAlive(pid: number) {
  try {
    // Signal 0 tests for existence without delivering anything
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Stop a server child process, escalating to SIGKILL if it doesn't go quietly.
 *
 * SIGTERM alone isn't enough in every case. The --debug-brk test deliberately
 * leaves the process blocked in `inspector.waitForDebugger()`, and a blocked
 * event loop can never run a JS signal handler - so if that test fails before
 * it resumes the process, SIGTERM is ignored forever. Escalating stops a
 * process like that from outliving its test and sitting on its ports.
 */
export async function stopProcess(p: ProcessPromise, graceMs = STOP_GRACE_MS) {
  // Attach this first. Killing a process makes zx reject, and an unhandled
  // rejection would take down the test run.
  const exited = p.catch(() => undefined)

  const pids = await collectPids(p)

  signalAll(pids, 'SIGTERM')

  if (await settledWithin(exited, graceMs)) {
    return
  }

  signalAll(pids.filter(isAlive), 'SIGKILL')

  // Bounded on purpose. zx settles on stdio close, and the grandchild inherits
  // those pipes, so the promise can stay pending after everything is dead. What
  // we need is the processes gone, not zx noticing.
  await settledWithin(exited, graceMs)
}

const timedOut = Symbol('timedOut')

/** Resolves true if `promise` settled within `ms`, false if it timed out */
async function settledWithin(promise: Promise<unknown>, ms: number) {
  let timer: NodeJS.Timeout | undefined

  const deadline = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), ms)
  })

  try {
    return (await Promise.race([promise, deadline])) !== timedOut
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Register a server child process for teardown when the current test ends.
 *
 * `onTestFinished` runs even when the test throws, and it keeps ownership next
 * to the code that started the process - rather than in a shared array drained
 * by a global hook, where one test's leaked process became the next test's
 * failure.
 */
export function autoStop(p: ProcessPromise) {
  onTestFinished(() => stopProcess(p))
  return p
}

export function sleep(time = 1_000) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

export async function pollForReady(
  url: string,
  opts: { timeout?: number; interval?: number } = {},
) {
  const { timeout = 30_000, interval = 250 } = opts
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url)

      if (res.status < 500) {
        return res
      }
    } catch {
      // not ready yet
    }

    await sleep(interval)
  }

  throw new Error(`Server at ${url} did not become ready within ${timeout}ms`)
}

export async function buildFixture(args: string[] = []) {
  // Runs from the monorepo root so yarn/node resolve correctly.
  // CEDAR_CWD (set in beforeAll) tells the Cedar CLI where the project is.
  await $`yarn node ${cedar} build api web --ud ${args}`
}
