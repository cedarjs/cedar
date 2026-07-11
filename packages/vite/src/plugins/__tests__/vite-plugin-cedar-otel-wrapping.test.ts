import path from 'node:path'

import { describe, it, expect, vi } from 'vitest'

import {
  cedarOtelWrappingPlugin,
  applyOtelWrapping,
} from '../vite-plugin-cedar-otel-wrapping.js'

const TEST_CEDAR_CWD = '/Users/test/cedar-app'
const API_SRC = path.join(TEST_CEDAR_CWD, 'api/src')

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: {
      src: API_SRC,
    },
  }),
}))

function getPluginTransform() {
  const plugin = cedarOtelWrappingPlugin()

  if (typeof plugin.transform !== 'function') {
    expect.fail('Expected plugin to have a transform function')
  }

  return plugin.transform.bind({} as ThisParameterType<typeof plugin.transform>)
}

const SERVICES_DIR = path.join(API_SRC, 'services')
const FUNCTIONS_DIR = path.join(API_SRC, 'functions')

describe('cedarOtelWrappingPlugin', () => {
  it('returns null for files outside api/src/', () => {
    const transform = getPluginTransform()
    const code = `export const contacts = () => db.contact.findMany()`

    const result = transform(
      code,
      path.join(TEST_CEDAR_CWD, 'web/src/pages/HomePage.tsx'),
    )

    expect(result).toBeNull()
  })

  it('returns null for node_modules files', () => {
    const transform = getPluginTransform()
    const code = `export const contacts = () => {}`

    const result = transform(
      code,
      path.join(TEST_CEDAR_CWD, 'node_modules/some-lib/index.js'),
    )

    expect(result).toBeNull()
  })

  it('transforms files in api/src/services/', () => {
    const transform = getPluginTransform()
    const code = `export const contacts = () => {
  return db.contact.findMany()
}`

    const result = transform(code, path.join(SERVICES_DIR, 'contacts.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain(
      "import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'",
    )
    expect(output).toContain('const __contacts = () =>')
    expect(output).toContain("RW_OTEL_WRAPPER_TRACE.getTracer('redwoodjs')")
    expect(output).toContain("'redwoodjs:api:services:contacts'")
  })

  it('transforms files in api/src/functions/', () => {
    const transform = getPluginTransform()
    const code = `export const handler = async (event, context) => {
  return { statusCode: 200 }
}`

    const result = transform(code, path.join(FUNCTIONS_DIR, 'custom.ts'))

    expect(result).not.toBeNull()
    const output = (result as { code: string }).code

    expect(output).toContain(
      "import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'",
    )
    expect(output).toContain("'redwoodjs:api:functions:handler'")
  })
})

describe('applyOtelWrapping', () => {
  const testFilename = path.join(SERVICES_DIR, 'contacts/contacts.ts')

  it('adds the OpenTelemetry import', () => {
    const code = `export const contacts = () => {
  return db.contact.findMany()
}`

    const output = applyOtelWrapping(code, testFilename, 'services')

    expect(output).not.toBeNull()
    expect(output).toContain(
      "import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'",
    )
  })

  it('wraps a simple synchronous exported arrow function', () => {
    const code = `export const contacts = () => {
  return db.contact.findMany()
}`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    // Renamed inner function
    expect(output).toContain('const __contacts = () =>')
    // Tracer creation
    expect(output).toContain("RW_OTEL_WRAPPER_TRACE.getTracer('redwoodjs')")
    // Span name
    expect(output).toContain("'redwoodjs:api:services:contacts'")
    // Span attributes
    expect(output).toContain("span.setAttribute('code.function', 'contacts')")
    expect(output).toContain(
      `span.setAttribute('code.filepath', ${JSON.stringify(testFilename)})`,
    )
    // Call the inner function (non-async, no await)
    expect(output).toContain(
      'const RW_OTEL_WRAPPER_INNER_RESULT = __contacts()',
    )
    // Error handling
    expect(output).toContain('span.recordException(error)')
    expect(output).toContain('span.setStatus(')
    // Return
    expect(output).toContain('return RW_OTEL_WRAPPER_RESULT')
    // NOT async (original was sync)
    expect(output).not.toContain(
      'const RW_OTEL_WRAPPER_RESULT = await RW_OTEL_WRAPPER_TRACER',
    )
  })

  it('wraps an async exported arrow function with await', () => {
    const code = `export const getPost = async (id) => {
  return db.post.findUnique({ where: { id } })
}`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    // Renamed inner function is async, preserves original source (with parens)
    expect(output).toContain('const __getPost = async (id) =>')
    // Span call is awaited
    expect(output).toContain(
      'const RW_OTEL_WRAPPER_RESULT = await RW_OTEL_WRAPPER_TRACER',
    )
    // Inner call is awaited
    expect(output).toContain(
      'const RW_OTEL_WRAPPER_INNER_RESULT = await __getPost',
    )
  })

  it('strips default values from ObjectPattern params when calling inner function', () => {
    const code = `export const contact = ({ id, input = {} }) => {
  return db.contact.findUnique({ where: { id } })
}`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    // Inner call should use { id, input } without default values
    expect(output).toContain('__contact({')
    expect(output).toContain('id')
    expect(output).toContain('input')
    // The default value should not appear in the call args
    expect(output).not.toContain('__contact({ id, input = {} })')
  })

  it('wraps a function with plain Identifier params', () => {
    const code = `export const deleteContact = (id, force) => {
  return db.contact.delete({ where: { id } })
}`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    // Inner function call passes identifiers directly
    expect(output).toContain('__deleteContact(id, force)')
  })

  it('handles AssignmentPattern (param = default) by passing the identifier only', () => {
    const code = `export const withDefault = async (args = {}) => {
  return args
}`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    // Inner call passes the identifier, not the default
    expect(output).toContain('__withDefault(args)')
  })

  it('bails out and does not wrap if param is an ArrayPattern', () => {
    const code = `import { db } from 'src/lib/db'

export const listItems = ([first, ...rest]) => {
  return [first, ...rest]
}`

    // ArrayPattern params are unsupported — nothing to wrap, returns null
    const output = applyOtelWrapping(code, testFilename, 'services')

    expect(output).toBeNull()
  })

  it('does not wrap non-arrow-function exports', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({
  sdls,
  services,
})`

    // No arrow function exports — nothing to wrap, returns null
    const output = applyOtelWrapping(code, testFilename, 'functions')

    expect(output).toBeNull()
  })

  it('wraps multiple exported functions in the same file', () => {
    const code = `export const getPosts = () => db.post.findMany()
export const getPost = (id) => db.post.findUnique({ where: { id } })`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    expect(output).toContain("'redwoodjs:api:services:getPosts'")
    expect(output).toContain("'redwoodjs:api:services:getPost'")
    expect(output).toContain('const __getPosts')
    expect(output).toContain('const __getPost')
  })

  it('uses the apiFolder in the span name', () => {
    const code = `export const handler = async (event) => ({ statusCode: 200 })`
    const fnFilename = path.join(FUNCTIONS_DIR, 'myFn.ts')

    const output = applyOtelWrapping(code, fnFilename, 'functions')!

    expect(output).toContain("'redwoodjs:api:functions:handler'")
  })

  it('sets span attributes with the correct function name and filepath', () => {
    const filename = path.join(SERVICES_DIR, 'posts/posts.ts')
    const code = `export const posts = () => db.post.findMany()`

    const output = applyOtelWrapping(code, filename, 'services')!

    expect(output).toContain("span.setAttribute('code.function', 'posts')")
    expect(output).toContain(
      `span.setAttribute('code.filepath', ${JSON.stringify(filename)})`,
    )
  })

  it('records exceptions and re-throws them', () => {
    const code = `export const risky = async () => { throw new Error('oops') }`

    const output = applyOtelWrapping(code, testFilename, 'services')!

    expect(output).toContain('span.recordException(error)')
    expect(output).toContain('span.setStatus(')
    // code: 2 is SpanStatusCode.ERROR
    expect(output).toContain('code: 2')
    expect(output).toContain('throw error')
  })
})
