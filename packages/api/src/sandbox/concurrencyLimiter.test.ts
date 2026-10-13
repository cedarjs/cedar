import { describe, expect, it } from 'vitest'

import { createConcurrencyLimiter } from './concurrencyLimiter.js'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe('createConcurrencyLimiter', () => {
  it('runs at most `max` at once, the rest in the order they came', async () => {
    const limit = createConcurrencyLimiter(2)
    const gates = Array.from({ length: 5 }, deferred)
    const started: number[] = []
    let running = 0
    let mostRunning = 0

    const all = Promise.all(
      gates.map((gate, i) =>
        limit(async () => {
          started.push(i)
          running += 1
          mostRunning = Math.max(mostRunning, running)
          await gate.promise
          running -= 1
          return i
        }),
      ),
    )

    await tick()
    expect(started).toEqual([0, 1])

    gates[1].resolve()
    await tick()
    expect(started).toEqual([0, 1, 2])

    gates.forEach((gate) => gate.resolve())
    expect(await all).toEqual([0, 1, 2, 3, 4])
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(mostRunning).toBe(2)
  })

  it('passes on a rejection and frees the slot', async () => {
    const limit = createConcurrencyLimiter(1)

    await expect(
      limit(() => Promise.reject(new Error('broken file'))),
    ).rejects.toThrow('broken file')
    expect(await limit(() => Promise.resolve('next'))).toBe('next')
  })

  it('refuses a limit that is not a positive integer', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow()
    expect(() => createConcurrencyLimiter(1.5)).toThrow()
  })
})
