import path from 'node:path'

import { dedent } from 'ts-dedent'
import { describe, it, expect, vi } from 'vitest'

import { handlerAlsWrappingPlugin } from '../vite-plugin-handler-als-wrapping.js'

const TEST_CEDAR_CWD = '/Users/test/cedar-app'

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: {
      src: path.join(TEST_CEDAR_CWD, 'api/src'),
    },
  }),
}))

function getPluginTransform(options?: { projectIsEsm?: boolean }) {
  const plugin = handlerAlsWrappingPlugin(options)

  if (typeof plugin.transform !== 'function') {
    expect.fail('Expected plugin to have a transform function')
  }

  return plugin.transform.bind({} as ThisParameterType<typeof plugin.transform>)
}

const FUNCTIONS_DIR = path.join(TEST_CEDAR_CWD, 'api/src/functions')

describe('handlerAlsWrappingPlugin', () => {
  it('wraps an async arrow function handler', () => {
    const transform = getPluginTransform()
    const code = dedent`
      import { logger } from 'src/lib/logger'

      export const handler = async (event, _context) => {
        logger.info('hello')
        return { statusCode: 200 }
      }
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain(
      "import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from '@cedarjs/context/dist/store'",
    )
    expect(output).toContain('const __rw_handler = async (event, _context) =>')
    expect(output).toContain(
      'export const handler = async (__rw_event, __rw__context) =>',
    )
    expect(output).toContain('__rw_getAsyncStoreInstance().getStore()')
    expect(output).toContain(
      '__rw_getAsyncStoreInstance().run(\n      new Map(),\n      __rw_handler,\n      __rw_event,\n      __rw__context',
    )
    expect(output).toContain('return __rw_handler(__rw_event, __rw__context)')
  })

  it('wraps a non-async handler (e.g. createGraphQLHandler call) without async keyword', () => {
    const transform = getPluginTransform()
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        sdls,
        services,
      })
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'graphql.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain('const __rw_handler = createGraphQLHandler({')
    // Wrapper must NOT be async (original was not an async function)
    expect(output).toContain(
      'export const handler = (__rw_event, __rw__context) =>',
    )
    expect(output).not.toContain(
      'export const handler = async (__rw_event, __rw__context)',
    )
  })

  it('uses the ESM store path when projectIsEsm is true', () => {
    const transform = getPluginTransform({ projectIsEsm: true })
    const code = `export const handler = async (event) => {}`

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain(
      "import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'",
    )
  })

  it('returns null for files outside api/src/functions/', () => {
    const transform = getPluginTransform()
    const code = `export const handler = async (event) => {}`

    // web side file - should not be transformed
    const result = transform(
      code,
      path.join(TEST_CEDAR_CWD, 'web/src/pages/HomePage.tsx'),
    )

    expect(result).toBeNull()
  })

  it('returns null for api files outside functions directory', () => {
    const transform = getPluginTransform()
    const code = `export const handler = async (event) => {}`

    const result = transform(
      code,
      path.join(TEST_CEDAR_CWD, 'api/src/lib/auth.ts'),
    )

    expect(result).toBeNull()
  })

  it('returns null for function files without a handler export', () => {
    const transform = getPluginTransform()
    const code = dedent`
      export const myHelper = () => {
        return 'not a handler'
      }
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'helper.ts'))

    expect(result).toBeNull()
  })

  it('preserves the rest of the file around the handler', () => {
    const transform = getPluginTransform()
    const code = dedent`
      import { db } from 'src/lib/db'

      const helperFn = () => 42

      export const handler = async (event, context) => {
        return { statusCode: 200 }
      }
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain("import { db } from 'src/lib/db'")
    expect(output).toContain('const helperFn = () => 42')
    expect(output).toContain('const __rw_handler = async (event, context) =>')
  })

  it('handles typed handler exports (TypeScript type annotations)', () => {
    const transform = getPluginTransform()
    const code = dedent`
      import type { APIGatewayProxyHandler } from 'aws-lambda'

      export const handler: APIGatewayProxyHandler = async (event, _context) => {
        return { statusCode: 200 }
      }
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    // Type annotation is stripped on renamed handler (matches Babel plugin behavior)
    expect(output).toContain('const __rw_handler = async (event, _context) =>')
    expect(output).not.toContain('const __rw_handler: APIGatewayProxyHandler')
    expect(output).toContain(
      'export const handler = async (__rw_event, __rw__context) =>',
    )
  })

  it('handles function type annotations containing =>', () => {
    const transform = getPluginTransform()
    const code = dedent`
      export const handler: (event: Event, context: Context) => Promise<Response> = async (event, context) => {
        return { statusCode: 200 }
      }
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    // Type annotation stripped, handler value correctly extracted despite => in type
    expect(output).toContain('const __rw_handler = async (event, context) =>')
    expect(output).toContain(
      'export const handler = async (__rw_event, __rw__context) =>',
    )
  })

  it('detects async keyword with no space before parenthesis', () => {
    const transform = getPluginTransform()
    const code = `export const handler = async(event, context) => { return {} }`

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    // Should be marked as async despite missing space
    expect(output).toContain(
      'export const handler = async (__rw_event, __rw__context) =>',
    )
  })

  it('detects async function expressions', () => {
    const transform = getPluginTransform()
    const code = dedent`
      export const handler = async function (event, context) {
        return { statusCode: 200 }
      }
    `

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain(
      'export const handler = async (__rw_event, __rw__context) =>',
    )
  })
})
