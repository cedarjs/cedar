import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { catchAllEntry } from '@universal-deploy/store'
import { describe, it, expect, vi, afterEach } from 'vitest'

import { cedarNetlifySkewProtectionPlugin } from '../vite-plugin-cedar-netlify-skew-protection.js'

const RESOLVED_SKEW_TOKEN_ID = '\0virtual:cedar-netlify-skew-token'

// writeBundle() only ever reads `getPaths().web.base`, so a minimal mock
// (rather than mocking the whole real, filesystem-anchored implementation)
// keeps these tests from depending on being run inside an actual Cedar
// project. `vi.hoisted` is required because `vi.mock` factories run before
// the rest of this module's top-level code (including plain `let`
// declarations) due to ESM import hoisting.
const mockPaths = vi.hoisted(() => ({ webBase: '' }))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({ web: { base: mockPaths.webBase } }),
}))

const FAKE_CATCH_ALL_SOURCE = `
export default {
  async fetch(request, ...args) {
    return new Response('ok', { headers: { 'content-type': 'text/plain' } })
  }
}`

const FAKE_CATCH_ALL_SOURCE_STATUS_101 = `
export default {
  async fetch(request, ...args) {
    // A real Response can't be constructed with a status outside 200-599
    // (the constructor throws immediately), so exotic platform-internal
    // responses like a WebSocket upgrade are duck-typed here instead.
    return { status: 101, headers: new Headers() }
  }
}`

const FAKE_CATCH_ALL_SOURCE_STATUS_204 = `
export default {
  async fetch(request, ...args) {
    return new Response(null, { status: 204 })
  }
}`

const FAKE_CATCH_ALL_SOURCE_STATUS_304 = `
export default {
  async fetch(request, ...args) {
    return new Response(null, { status: 304 })
  }
}`

const FAKE_CATCH_ALL_SOURCE_WITH_EXISTING_COOKIE = `
export default {
  async fetch(request, ...args) {
    return new Response('ok', {
      headers: { 'set-cookie': 'cedar-skew-token=already-set' },
    })
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

    it('does not wrap the response when the handler returns a status outside 200-599', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const result = await plugin.transform.call(
        withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
        FAKE_CATCH_ALL_SOURCE_STATUS_101,
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

      expect(response.status).toBe(101)
      expect(response.headers.get('set-cookie')).toBeNull()
    })

    it.each([204, 304])(
      'does not wrap the response when the handler returns status %i',
      async (status) => {
        const plugin = cedarNetlifySkewProtectionPlugin()

        if (typeof plugin.transform !== 'function') {
          expect.fail('Expected plugin to have a transform function')
        }

        const source =
          status === 204
            ? FAKE_CATCH_ALL_SOURCE_STATUS_204
            : FAKE_CATCH_ALL_SOURCE_STATUS_304

        const result = await plugin.transform.call(
          withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
          source,
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

        expect(response.status).toBe(status)
        expect(response.headers.get('set-cookie')).toBeNull()
      },
    )

    it('does not duplicate the cookie when the response already carries one for our cookie name', async () => {
      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.transform !== 'function') {
        expect.fail('Expected plugin to have a transform function')
      }

      const result = await plugin.transform.call(
        withEnvironment('ssr') as ThisParameterType<typeof plugin.transform>,
        FAKE_CATCH_ALL_SOURCE_WITH_EXISTING_COOKIE,
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

      expect(response.headers.get('set-cookie')).toBe(
        'cedar-skew-token=already-set',
      )
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

  describe('writeBundle', () => {
    const tmpDirs: string[] = []

    afterEach(async () => {
      delete process.env.NETLIFY_SKEW_PROTECTION_TOKEN
      await Promise.all(
        tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true })),
      )
    })

    async function makeTmpWebBase() {
      const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'cedar-skew-protection-writebundle-'),
      )
      tmpDirs.push(dir)
      mockPaths.webBase = dir
      return dir
    }

    function withClientEnvironment() {
      return {
        environment: { name: 'client' },
      } as ThisParameterType<
        NonNullable<
          ReturnType<typeof cedarNetlifySkewProtectionPlugin>['writeBundle']
        >
      >
    }

    it('writes the skew-protection manifest and edge function when a build-time token is present', async () => {
      process.env.NETLIFY_SKEW_PROTECTION_TOKEN = 'deploy-xyz'
      const dir = await makeTmpWebBase()

      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.writeBundle !== 'function') {
        expect.fail('Expected plugin to have a writeBundle function')
      }

      await plugin.writeBundle.call(withClientEnvironment(), {} as never, {})

      const netlifyV1Dir = path.join(dir, '.netlify', 'v1')

      const manifest = JSON.parse(
        await fs.readFile(
          path.join(netlifyV1Dir, 'skew-protection.json'),
          'utf-8',
        ),
      )
      expect(manifest).toEqual({
        patterns: ['.*'],
        sources: [
          { type: 'header', name: 'cedar-skew-token' },
          { type: 'query', name: 'skew' },
          { type: 'cookie', name: 'cedar-skew-token' },
        ],
      })

      const edgeFunctionCode = await fs.readFile(
        path.join(netlifyV1Dir, 'edge-functions', 'cedar-skew-cookie.js'),
        'utf-8',
      )
      expect(edgeFunctionCode).toContain(
        'export default async (request, context) =>',
      )
      expect(edgeFunctionCode).toContain('export const config = {')
      expect(edgeFunctionCode).toContain('path: "/*"')
      expect(edgeFunctionCode).toContain('cedar-skew-token')
    })

    it('does nothing when there is no build-time token', async () => {
      const dir = await makeTmpWebBase()

      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.writeBundle !== 'function') {
        expect.fail('Expected plugin to have a writeBundle function')
      }

      await plugin.writeBundle.call(withClientEnvironment(), {} as never, {})

      await expect(fs.access(path.join(dir, '.netlify'))).rejects.toThrow()
    })

    it('does nothing outside the client environment', async () => {
      process.env.NETLIFY_SKEW_PROTECTION_TOKEN = 'deploy-xyz'
      const dir = await makeTmpWebBase()

      const plugin = cedarNetlifySkewProtectionPlugin()

      if (typeof plugin.writeBundle !== 'function') {
        expect.fail('Expected plugin to have a writeBundle function')
      }

      await plugin.writeBundle.call(
        { environment: { name: 'ssr' } } as ThisParameterType<
          NonNullable<
            ReturnType<typeof cedarNetlifySkewProtectionPlugin>['writeBundle']
          >
        >,
        {} as never,
        {},
      )

      await expect(fs.access(path.join(dir, '.netlify'))).rejects.toThrow()
    })

    describe('the generated edge function', () => {
      async function loadEdgeFunction(dir: string) {
        const modulePath = path.join(
          dir,
          '.netlify',
          'v1',
          'edge-functions',
          'cedar-skew-cookie.js',
        )
        const mod = await import(pathToFileURL(modulePath).href)
        return mod.default as (
          request: Request,
          context: {
            next: () => Promise<Response>
            deploy?: { skewProtectionToken?: string }
          },
        ) => Promise<Response>
      }

      async function generate(token: string) {
        process.env.NETLIFY_SKEW_PROTECTION_TOKEN = token
        const dir = await makeTmpWebBase()

        const plugin = cedarNetlifySkewProtectionPlugin()
        if (typeof plugin.writeBundle !== 'function') {
          expect.fail('Expected plugin to have a writeBundle function')
        }
        await plugin.writeBundle.call(withClientEnvironment(), {} as never, {})

        return loadEdgeFunction(dir)
      }

      it('stamps the cookie using the runtime skew-protection token', async () => {
        const handler = await generate('deploy-xyz')

        const response = await handler(new Request('http://localhost/'), {
          next: async () =>
            new Response('<html></html>', {
              headers: { 'content-type': 'text/html' },
            }),
          deploy: { skewProtectionToken: 'deploy-runtime-token' },
        })

        expect(response.headers.get('set-cookie')).toContain(
          'cedar-skew-token=deploy-runtime-token',
        )
        expect(response.headers.get('set-cookie')).toContain('HttpOnly')
        expect(response.headers.get('content-type')).toBe('text/html')
      })

      it('does not stamp when there is no runtime skew-protection token', async () => {
        const handler = await generate('deploy-xyz')

        const response = await handler(new Request('http://localhost/'), {
          next: async () => new Response('<html></html>'),
          deploy: {},
        })

        expect(response.headers.get('set-cookie')).toBeNull()
      })

      it('does not duplicate the cookie if one is already set further up the chain', async () => {
        const handler = await generate('deploy-xyz')

        const response = await handler(new Request('http://localhost/'), {
          next: async () =>
            new Response('<html></html>', {
              headers: { 'set-cookie': 'cedar-skew-token=already-set' },
            }),
          deploy: { skewProtectionToken: 'deploy-runtime-token' },
        })

        expect(response.headers.get('set-cookie')).toBe(
          'cedar-skew-token=already-set',
        )
      })

      it.each([204, 304])(
        'does not wrap the response for status %i',
        async (status) => {
          const handler = await generate('deploy-xyz')

          const response = await handler(new Request('http://localhost/'), {
            next: async () => new Response(null, { status }),
            deploy: { skewProtectionToken: 'deploy-runtime-token' },
          })

          expect(response.status).toBe(status)
          expect(response.headers.get('set-cookie')).toBeNull()
        },
      )
    })
  })
})
