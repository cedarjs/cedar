import { PinoLogWriter } from '@graphql-hive/logger/writers/pino'
import { Logger as YogaLogger } from 'graphql-yoga'

import type { Logger } from '@cedarjs/api/logger'

/**
 * The `LOG_LEVEL` values the `@graphql-hive/logger` Logger constructor
 * accepts. It throws for any other value, including `silent` and `fatal`,
 * which Cedar's logger accepts.
 */
const HIVE_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error'])

/**
 * Runs `create` with `LOG_LEVEL` hidden from the environment when it holds a
 * value the Hive Logger constructor rejects. The constructor only validates
 * the variable when an explicit `level` is passed, and every Logger made here
 * gets one, so hiding the variable changes nothing else. `create` runs
 * synchronously, so no other code observes the missing variable.
 */
function withHiveCompatibleLogLevel<T>(create: () => T): T {
  const logLevel = process.env.LOG_LEVEL

  if (logLevel === undefined || HIVE_LOG_LEVELS.has(logLevel)) {
    return create()
  }

  delete process.env.LOG_LEVEL

  try {
    return create()
  } finally {
    process.env.LOG_LEVEL = logLevel
  }
}

/**
 * Wraps a Hive Logger so that the child loggers Yoga creates for every
 * request are also constructed with a compatible `LOG_LEVEL`.
 */
function wrapLogger(logger: YogaLogger): YogaLogger {
  return new Proxy(logger, {
    get(target, property) {
      if (property === 'child') {
        return (...args: Parameters<YogaLogger['child']>) =>
          wrapLogger(withHiveCompatibleLogLevel(() => target.child(...args)))
      }

      // Read from the target itself and bind its methods to it, because the
      // Logger keeps its state in private class fields, which a proxy
      // receiver can't access
      const value: unknown = Reflect.get(target, property, target)

      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Creates the Logger Yoga logs through. Every message goes to Cedar's logger,
 * and the `trace` level leaves the filtering to that logger's own level.
 */
export function createYogaLogger(logger: Logger): YogaLogger {
  return wrapLogger(
    withHiveCompatibleLogLevel(
      () =>
        new YogaLogger({
          level: 'trace',
          writers: [new PinoLogWriter(logger)],
        }),
    ),
  )
}
