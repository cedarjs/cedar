import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { catchAllEntry } from '@universal-deploy/store'
import { describe, it, expect } from 'vitest'

import { cedarNetlifySkewProtectionPlugin } from '../vite-plugin-cedar-netlify-skew-protection.js'

const RESOLVED_SKEW_TOKEN_ID = '\0virtual:cedar-netlify-skew-token'

const FAKE_CATCH_ALL_SOURCE = `
export default {
  async fetch(request, ...args) {
    return new Response('ok', { headers: { 'content-type': 'text/plain' } })
  }
}`

function withEnvironment(name: string) {
  return { environment: { name }, warn: () => {} }
}

function isResultWithCode(
  result: unknown,
): result is { code: string; map: null } {
  return typeof result === 'object' && result !== null && 'code' in result
}

/**
 * The real transform output imports CEDAR_SKEW_TOKEN/CEDAR_SKEW_COOKIE_NAME
 * from the virtual:cedar-netlify-skew-token module, which only Vite can
 * resolve. To actually execute the wrapped fetch (rather than just asserting
 * on the generated source as a string), swap that import for literal
 * bindings and dynamically import the result as a real ES module.
 */
async function loadWrappedHandler(
  code: string,
  tokenBindings: { token: string; cookieName: string },
) {
  const inlined = code.replace(
    /^import \{ CEDAR_SKEW_TOKEN, CEDAR_SKEW_COOKIE_NAME \} from .*$/m,
    [
      `const CEDAR_SKEW_TOKEN = ${JSON.stringify(tokenBindings.token)}`,
      `const CEDAR_SKEW_COOKIE_NAME = ${JSON.stringify(tokenBindings.cookieName)}`,
    ].join('\n'),
  )

  const tmpFile = path.join(
    os.tmpdir(),
    `cedar-skew-protection-test-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  )

  await fs.writeFile(tmpFile, inlined)

  try {
    const mod = await import(pathToFileURL(tmpFile).href)
    return mod.default as { fetch: (request: Request) => Promise<Response> }
  } finally {
    await fs.unlink(tmpFile)
  }
}

describe('cedarNetlifySkewProtectionPlugin', () => {
  describe('transform', () => {
    it('stamps the skew-token cookie onto responses when a build-time token is present', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const result = await plugin.transform.call(
        withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
        FAKE_CATCH_ALL_SOURCE,
        catchAllEntry,
        {},
      )

      if (!isResultWithCode(result)) {
        throw new Error('transform should have returned a result with code')
      }

      const handler = await loadWrappedHandler(result.code, {
        token: 'deploy-abc',
        cookieName: 'cedar-skew-token',
      })

      const response = await handler.fetch(new Request('http://localhost/'))

      expect(response.headers.get('set-cookie')).toContain(
        'cedar-skew-token=deploy-abc',
      )
      expect(response.headers.get('set-cookie')).toContain('HttpOnly')
      expect(response.headers.get('set-cookie')).toContain('Secure')
      // The original response's own headers must survive the wrap.
      expect(response.headers.get('content-type')).toBe('text/plain')
      await expect(response.text()).resolves.toBe('ok')
    })

    it('passes the response through unchanged when there is no build-time token', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const result = await plugin.transform.call(
        withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
        FAKE_CATCH_ALL_SOURCE,
        catchAllEntry,
        {},
      )

      if (!isResultWithCode(result)) {
        throw new Error('transform should have returned a result with code')
      }

      const handler = await loadWrappedHandler(result.code, {
        token: '',
        cookieName: 'cedar-skew-token',
      })

      const response = await handler.fetch(new Request('http://localhost/'))

      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('content-type')).toBe('text/plain')
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

      const result = await plugin.transform.call(
        withEnvironment('client') as ThisParameterType<typeof plugin.transform>,
        FAKE_CATCH_ALL_SOURCE,
        catchAllEntry,
        {},
      )

      expect(result).toBeUndefined()
    })

    it('warns and skips wrapping if the catch-all module does not match the expected shape', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const warnings: unknown[] = []
      const result = await plugin.transform.call(
        {
          environment: { name: 'ssr' },
          warn: (msg: unknown) => warnings.push(msg),
        } as ThisParameterType<typeof plugin.transform>,
        'export const somethingElse = 1',
        catchAllEntry,
        {},
      )

      expect(result).toBeUndefined()
      expect(warnings).toHaveLength(1)
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
