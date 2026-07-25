import { describe, it, expect, vi } from 'vitest'

import { createShutdownHandler } from '../cedar-unified-dev.js'

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn() }
}

function never() {
  return new Promise<void>(() => {})
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createShutdownHandler', () => {
  it('closes the servers and exits', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn()

    await createShutdownHandler({ close, exit, logger: makeLogger() })()

    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits even when close() never settles', async () => {
    const exit = vi.fn()
    const logger = makeLogger()

    const shutdown = createShutdownHandler({
      close: never,
      timeoutMs: 50,
      exit,
      logger,
    })

    // Deliberately not awaited - the whole point is that it never resolves
    shutdown()

    expect(exit).not.toHaveBeenCalled()

    await sleep(120)

    expect(exit).toHaveBeenCalledWith(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('did not shut down within 50ms'),
    )
  })

  it('exits even when close() rejects', async () => {
    const exit = vi.fn()
    const logger = makeLogger()

    await createShutdownHandler({
      close: () => Promise.reject(new Error('server.close() blew up')),
      exit,
      logger,
    })()

    expect(exit).toHaveBeenCalledWith(0)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('server.close() blew up'),
    )
  })

  it('exits immediately on a second signal, without waiting for close()', async () => {
    const exit = vi.fn()
    const close = vi.fn(never)

    const shutdown = createShutdownHandler({
      close,
      timeoutMs: 60_000,
      exit,
      logger: makeLogger(),
    })

    shutdown()
    await shutdown()

    expect(exit).toHaveBeenCalledWith(0)
    // The hung close() from the first signal is never retried
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not close the servers twice', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn()

    const shutdown = createShutdownHandler({
      close,
      exit,
      logger: makeLogger(),
    })

    await shutdown()
    await shutdown()

    expect(close).toHaveBeenCalledTimes(1)
  })
})
