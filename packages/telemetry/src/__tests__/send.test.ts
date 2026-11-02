import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import type { PendingTelemetryEvent } from '../cli.js'

vi.mock('../telemetry.js', () => ({ spawnSender: vi.fn() }))

vi.mock('../environment.js', () => ({
  getTelemetryEnvironment: async () => ({ osType: 'macOS', cpuCount: 8 }),
}))

vi.mock('@cedarjs/structure/dist/model/RWProject', () => ({
  RWProject: class {
    sides = ['web', 'api']
    services = [1, 2]
    cells = [1]
    pages = [1, 2, 3]
    getRouter() {
      return { routes: [{ hasPrerender: true }, { hasPrerender: false }] }
    }
  },
}))

const { startTelemetry, shutdownTelemetry, getTelemetryDir } =
  await import('../cli.js')
const { sendPendingTelemetry, getTelemetryUid } = await import('../send.js')
const { recordTelemetryAttributes, recordTelemetryError } =
  await import('../record.js')
const { spawnSender } = await import('../telemetry.js')

const originalCwd = process.env.CEDAR_CWD
let projectDir: string

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-telemetry-'))
  fs.writeFileSync(
    path.join(projectDir, 'cedar.toml'),
    '[web]\n[api]\n[experimental.opentelemetry]\nenabled = false\n',
  )
  process.env.CEDAR_CWD = projectDir
})

afterEach(() => {
  if (originalCwd === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = originalCwd
  }

  fs.rmSync(projectDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function writeEvent(file: string, event: Partial<PendingTelemetryEvent>) {
  fs.mkdirSync(getTelemetryDir(), { recursive: true })
  fs.writeFileSync(path.join(getTelemetryDir(), file), JSON.stringify(event))
}

const pendingEvent: PendingTelemetryEvent = {
  type: 'command',
  timestamp: '2026-10-26T12:00:00.000Z',
  command: 'build',
  durationMs: 1234,
  attributes: { verbose: false },
  error: undefined,
  cedarVersion: '7.1.0',
}

describe('startTelemetry and shutdownTelemetry', () => {
  it('writes one event with everything recorded, then starts the sender', () => {
    startTelemetry({ cedarVersion: '7.1.0' })

    recordTelemetryAttributes({ command: 'generate page', force: true })
    recordTelemetryError(new Error('Could not write /home/ada/app/x.ts'))

    shutdownTelemetry()
    // A second call (e.g. from the `exit` handler) does nothing
    shutdownTelemetry()

    const files = fs.readdirSync(getTelemetryDir())
    expect(files).toHaveLength(1)

    const event = JSON.parse(
      fs.readFileSync(path.join(getTelemetryDir(), files[0]), 'utf-8'),
    )

    expect(event).toMatchObject({
      type: 'command',
      command: 'generate page',
      attributes: { force: true },
      error: 'Could not write [path]',
      cedarVersion: '7.1.0',
    })
    expect(event.durationMs).toBeGreaterThanOrEqual(0)
    expect(spawnSender).toHaveBeenCalledTimes(1)
  })
})

describe('sendPendingTelemetry', () => {
  it('sends unsent events with the uid, environment and project added', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    writeEvent('1000.json', pendingEvent)
    writeEvent('_900.json', pendingEvent)

    await sendPendingTelemetry()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://telemetry.cedarjs.com')

    const payload = JSON.parse(String(init.body))
    expect(payload).toEqual({
      ...pendingEvent,
      uid: getTelemetryUid(),
      environment: { osType: 'macOS', cpuCount: 8 },
      project: {
        complexity: '2.1.2.1.3',
        sides: ['web', 'api'],
        experiments: ['opentelemetry'],
      },
    })

    expect(fs.readdirSync(getTelemetryDir()).sort()).toEqual([
      '_1000.json',
      '_900.json',
    ])
  })

  it('keeps events that fail to send for the next run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    )

    writeEvent('1000.json', pendingEvent)

    await sendPendingTelemetry()

    expect(fs.readdirSync(getTelemetryDir())).toEqual(['1000.json'])
  })

  it('deletes files that are not valid events, and keeps only the newest 8', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )

    // A file written in an older format (a JSON array of spans)
    writeEvent('5.json', [] as Partial<PendingTelemetryEvent>)

    for (let time = 10; time < 20; time++) {
      writeEvent(`_${time}.json`, pendingEvent)
    }

    await sendPendingTelemetry()

    expect(fs.readdirSync(getTelemetryDir()).sort()).toEqual(
      [12, 13, 14, 15, 16, 17, 18, 19].map((time) => `_${time}.json`).sort(),
    )
  })

  it('sends each event once when senders run at the same time', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    writeEvent('1000.json', pendingEvent)
    writeEvent('1001.json', pendingEvent)

    await Promise.all([sendPendingTelemetry(), sendPendingTelemetry()])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fs.readdirSync(getTelemetryDir()).sort()).toEqual([
      '_1000.json',
      '_1001.json',
    ])
  })

  it('releases claims left behind by a sender that died', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    writeEvent('1000.json.sending', pendingEvent)
    const claimPath = path.join(getTelemetryDir(), '1000.json.sending')
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    fs.utimesSync(claimPath, anHourAgo, anHourAgo)

    // A recent claim belongs to a sender that's still running
    writeEvent('1001.json.sending', pendingEvent)

    await sendPendingTelemetry()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(getTelemetryDir()).sort()).toEqual([
      '1001.json.sending',
      '_1000.json',
    ])
  })

  it('sends to CEDAR_REDIRECT_TELEMETRY when set', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('CEDAR_REDIRECT_TELEMETRY', 'http://localhost:4318/events')

    writeEvent('1000.json', pendingEvent)

    await sendPendingTelemetry()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:4318/events')
    vi.unstubAllEnvs()
  })
})

describe('getTelemetryUid', () => {
  it('reuses the stored ID for 24 hours, then replaces it', () => {
    const uid = getTelemetryUid()
    expect(getTelemetryUid()).toBe(uid)

    const uidFile = path.join(projectDir, '.cedar', 'telemetry.txt')
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    fs.utimesSync(uidFile, twoDaysAgo, twoDaysAgo)

    expect(getTelemetryUid()).not.toBe(uid)
  })
})
