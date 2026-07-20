import { describe, it, expect } from 'vitest'

import { cedarApiLogFormatterDevPlugin } from '../vite-plugin-cedar-log-formatter-dev'

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
      // Only this one export is overridden
      expect(code).toContain('export function createLogger(')
      // Doesn't clobber a destination the caller already supplied
      expect(code).toContain('if (params.destination)')
    })
  })
})
