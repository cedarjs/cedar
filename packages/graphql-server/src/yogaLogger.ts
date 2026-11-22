import { Logger as YogaLogger } from '@graphql-hive/logger'
import { PinoLogWriter } from '@graphql-hive/logger/writers/pino'

import type { Logger } from '@cedarjs/api/logger'

/**
 * Creates the Logger Yoga logs through. Every message goes to Cedar's logger,
 * and the `trace` level leaves the filtering to that logger's own level.
 */
export function createYogaLogger(logger: Logger): YogaLogger {
  return new YogaLogger({
    level: 'trace',
    writers: [new PinoLogWriter(logger)],
  })
}
