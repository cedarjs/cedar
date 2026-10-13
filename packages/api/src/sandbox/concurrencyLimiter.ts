/**
 * Runs `fn` once a slot is free; resolves or rejects with what `fn` does.
 */
export type ConcurrencyLimiter = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * A limiter that lets at most `max` tasks run at once; the rest wait their
 * turn, first come first served. Use it around `runSandboxedChild()`: each
 * sandboxed child is a whole Node process, and a burst of uploads shouldn't
 * start a hundred of them.
 *
 * The limit is per limiter, in this process. Create one per kind of work
 * at module level, not one per call.
 *
 * @example
 * ```ts
 * const limit = createConcurrencyLimiter(2)
 *
 * const result = await limit(() => runSandboxedChild({ ... }))
 * ```
 */
export const createConcurrencyLimiter = (max: number): ConcurrencyLimiter => {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`max must be a positive integer, got ${max}`)
  }

  let running = 0
  const waiting: (() => void)[] = []

  const acquire = async () => {
    if (running < max) {
      running += 1
      return
    }
    // The slot is handed over by release(), so `running` stays the same
    await new Promise<void>((resolve) => waiting.push(resolve))
  }

  const release = () => {
    const next = waiting.shift()
    if (next) {
      next()
    } else {
      running -= 1
    }
  }

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
