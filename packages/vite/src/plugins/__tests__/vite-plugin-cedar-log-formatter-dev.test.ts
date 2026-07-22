import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  cedarApiLogFormatterDevPlugin,
  createFormattingDestination,
} from '../vite-plugin-cedar-log-formatter-dev'

vi.mock('@cedarjs/api-server/logFormatter', () => {
  const LogFormatter = () => (line: string) => `[FORMATTED] ${line}`
  return { LogFormatter }
})

const RESOLVED_VIRTUAL_MODULE_ID = '\0virtual:cedar-api-logger-dev'

describe('cedarApiLogFormatterDevPlugin', () => {
  describe('resolveId', () => {
    it('redirects @cedarjs/api/logger to the virtual module', () => {
      const plugin = cedarApiLogFormatterDevPlugin()

      // @ts-expect-error resolveId is typed as a union to support Rollup's
      // object-hook form; this plugin only ever uses the plain function form
      const result = plugin.resolveId(
        '@cedarjs/api/logger',
        'src/lib/logger.ts',
      )

      expect(result).toEqual(RESOLVED_VIRTUAL_MODULE_ID)
    })

    it('does not intercept the virtual module importing the real package', () => {
      const plugin = cedarApiLogFormatterDevPlugin()

      // @ts-expect-error see above
      const result = plugin.resolveId(
        '@cedarjs/api/logger',
        RESOLVED_VIRTUAL_MODULE_ID,
      )

      expect(result).toBeNull()
    })

    it('leaves unrelated specifiers alone', () => {
      const plugin = cedarApiLogFormatterDevPlugin()

      // @ts-expect-error see above
      const result = plugin.resolveId('@cedarjs/api/cache', 'src/lib/logger.ts')

      expect(result).toBeNull()
    })
  })

  describe('load', () => {
    it('returns null for unrelated ids', () => {
      const plugin = cedarApiLogFormatterDevPlugin()

      // @ts-expect-error see above
      const result = plugin.load('src/lib/logger.ts')

      expect(result).toBeNull()
    })

    it('generates a module that re-exports the real logger and overrides createLogger', () => {
      const plugin = cedarApiLogFormatterDevPlugin()

      // @ts-expect-error see above
      const code = plugin.load(RESOLVED_VIRTUAL_MODULE_ID) as string

      expect(code).toContain('from "@cedarjs/api/logger"')
      expect(code).toContain("from '@cedarjs/api-server/logFormatter'")
      // Passes through every other export from the real module unchanged
      expect(code).toContain('export * from "@cedarjs/api/logger"')
      // Overrides createLogger (serialized from the exported function)
      expect(code).toContain('function createLogger(')
      // Doesn't clobber a destination the caller already supplied
      expect(code).toContain('if (params.destination)')
    })
  })
})

describe('createFormattingDestination', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('formats and writes a single complete log line', () => {
    const dest = createFormattingDestination()
    const writeSpy = vi.mocked(process.stdout.write)

    dest.write('{"level":30,"msg":"hello"}\n')

    expect(writeSpy).toHaveBeenCalledOnce()
    expect(writeSpy.mock.calls[0][0]).toContain('{"level":30,"msg":"hello"}')
  })

  it('handles partial chunks buffered across multiple writes', () => {
    const dest = createFormattingDestination()
    const writeSpy = vi.mocked(process.stdout.write)

    dest.write('{"level":30,"msg":"hello"}\n{"level":')
    dest.write('40,"msg":"world"}\n')

    expect(writeSpy).toHaveBeenCalledTimes(2)
    expect(writeSpy.mock.calls[0][0]).toContain('{"level":30,"msg":"hello"}')
    expect(writeSpy.mock.calls[1][0]).toContain('{"level":40,"msg":"world"}')
  })

  it('skips empty lines in the buffer', () => {
    const dest = createFormattingDestination()
    const writeSpy = vi.mocked(process.stdout.write)

    dest.write('\n{"level":30,"msg":"hello"}\n\n\n')

    expect(writeSpy).toHaveBeenCalledOnce()
    expect(writeSpy.mock.calls[0][0]).toContain('{"level":30,"msg":"hello"}')
  })

  it('buffers a chunk with no newline', () => {
    const dest = createFormattingDestination()
    const writeSpy = vi.mocked(process.stdout.write)

    dest.write('{"level":30,"msg":"partial"}')

    expect(writeSpy).not.toHaveBeenCalled()
  })
})
