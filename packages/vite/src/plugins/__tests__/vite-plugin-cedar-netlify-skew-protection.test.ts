import { catchAllEntry } from '@universal-deploy/store'
import { describe, it, expect } from 'vitest'

import { cedarNetlifySkewProtectionPlugin } from '../vite-plugin-cedar-netlify-skew-protection.js'

const RESOLVED_SKEW_TOKEN_ID = '\0virtual:cedar-netlify-skew-token'

function withEnvironment(name: string) {
  return { environment: { name } }
}

function isResultWithCode(
  result: unknown,
): result is { code: string; map: null } {
  return typeof result === 'object' && result !== null && 'code' in result
}

describe('cedarNetlifySkewProtectionPlugin', () => {
  describe('transform', () => {
    it('injects an import of the skew-token module into the UD catch-all SSR entry', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const code = 'export default { fetch() {} }'
      const result = await plugin.transform.call(
        withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
        code,
        catchAllEntry,
        {},
      )

      if (!isResultWithCode(result)) {
        throw new Error('transform should have returned a result with code')
      }

      expect(result.code).toContain('import "virtual:cedar-netlify-skew-token"')
      // The original source must still be present, unwrapped and untouched.
      expect(result.code).toContain(code)
    })

    it('leaves non-catch-all modules untouched, even in the ssr environment', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const code = 'export const handler = () => {}'
      const result = await plugin.transform.call(
        withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
        code,
        '/project/api/src/functions/graphql.ts',
        {},
      )

      expect(result).toBeUndefined()
    })

    it('leaves the catch-all module untouched outside the ssr environment', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const code = 'export default { fetch() {} }'
      const result = await plugin.transform.call(
        withEnvironment('client') as ThisParameterType<typeof plugin.transform>,
        code,
        catchAllEntry,
        {},
      )

      expect(result).toBeUndefined()
    })
  })

  describe('resolveId / load', () => {
    it('resolves the virtual skew-token id to a private resolved id', () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.resolveId !== 'function') {
        expect.fail('Expected plugin to have a resolveId function')
      }

      const resolved = (plugin.resolveId as (id: string) => string | undefined)(
        'virtual:cedar-netlify-skew-token',
      )

      expect(resolved).toBe(RESOLVED_SKEW_TOKEN_ID)
    })

    it('loads the resolved skew-token module with the configured names and build-time token', () => {
      process.env.NETLIFY_SKEW_PROTECTION_TOKEN = 'deploy-123'

      try {
        const plugin = cedarNetlifySkewProtectionPlugin({
          headerName: 'custom-header',
          queryName: 'custom-query',
          cookieName: 'custom-cookie',
        })

        if (typeof plugin.load !== 'function') {
          expect.fail('Expected plugin to have a load function')
        }

        const code = (plugin.load as (id: string) => string | undefined)(
          RESOLVED_SKEW_TOKEN_ID,
        )

        expect(code).toContain('CEDAR_SKEW_TOKEN = "deploy-123"')
        expect(code).toContain('CEDAR_SKEW_HEADER_NAME = "custom-header"')
        expect(code).toContain('CEDAR_SKEW_QUERY_NAME = "custom-query"')
        expect(code).toContain('CEDAR_SKEW_COOKIE_NAME = "custom-cookie"')
      } finally {
        delete process.env.NETLIFY_SKEW_PROTECTION_TOKEN
      }
    })

    it('returns undefined for unrelated ids', () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.load !== 'function') {
        expect.fail('Expected plugin to have a load function')
      }

      const code = (plugin.load as (id: string) => string | undefined)(
        '/project/src/some-other-module.ts',
      )

      expect(code).toBeUndefined()
    })
  })
})
