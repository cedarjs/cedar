import { describe, it, expect } from 'vitest'

import {
  collectTelemetry,
  recordTelemetryAttributes,
  recordTelemetryError,
} from '../record.js'
import type { TelemetryAttributes } from '../record.js'

describe('collectTelemetry', () => {
  it('collects recorded attributes, later values winning', () => {
    const collector = collectTelemetry()

    recordTelemetryAttributes({ command: 'generate page', force: false })
    recordTelemetryAttributes({ force: true, verbose: undefined })

    collector.stop()

    expect(collector.attributes).toEqual({
      command: 'generate page',
      force: true,
    })
  })

  it('drops values that are not strings, finite numbers or booleans', () => {
    const collector = collectTelemetry()
    // Untyped callers (e.g. CLI plugins written in JS) can pass anything
    const attributes: Record<string, unknown> = {
      count: 3,
      object: { a: 1 },
      nan: NaN,
    }

    recordTelemetryAttributes(attributes as TelemetryAttributes)

    collector.stop()

    expect(collector.attributes).toEqual({ count: 3 })
  })

  it('records the redacted first line of the last error', () => {
    const collector = collectTelemetry()

    recordTelemetryError(new Error('first'))
    recordTelemetryError(
      new Error('Could not read /Users/ada/app/api/src/x.ts\n    at foo'),
    )

    collector.stop()

    expect(collector.error).toBe('Could not read [path]')
  })

  it('ignores records published after stop()', () => {
    const collector = collectTelemetry()
    collector.stop()

    recordTelemetryAttributes({ command: 'dev' })

    expect(collector.attributes).toEqual({})
  })

  it('is a no-op to record without a collector', () => {
    expect(() => recordTelemetryAttributes({ command: 'dev' })).not.toThrow()
    expect(() => recordTelemetryError(new Error('x'))).not.toThrow()
  })
})
