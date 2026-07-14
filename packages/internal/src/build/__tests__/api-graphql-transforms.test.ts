import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { transform } from 'esbuild'
import { dedent } from 'ts-dedent'
import { describe, expect, it } from 'vitest'

import { applyGraphqlOptionsExtract } from '../api-graphql-transforms.js'

describe('applyGraphqlOptionsExtract', () => {
  it('extracts object literal options from createGraphQLHandler', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        loggerConfig: { logger, options: {} },
        services,
      })
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain(
      'export const __cedar_graphqlOptions = {\n  loggerConfig: { logger, options: {} },\n  services,\n}',
    )
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('handles aliased imports of createGraphQLHandler', () => {
    const code = dedent`
      import { createGraphQLHandler as someOtherFunctionName } from '@cedarjs/graphql-server'

      const graphQLHandler = someOtherFunctionName({
        loggerConfig: { logger, options: {} },
      })
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain(
      'export const __cedar_graphqlOptions = {\n  loggerConfig: { logger, options: {} },\n}',
    )
    expect(result).toContain('someOtherFunctionName(__cedar_graphqlOptions)')
  })

  it('extracts variable reference options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      const config = { services }

      export const handler = createGraphQLHandler(config)
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain('export const __cedar_graphqlOptions = config')
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('extracts call expression options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler(config())
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain('export const __cedar_graphqlOptions = config()')
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('extracts conditional expression options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler(cond ? config : { sadness: true })
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain(
      'export const __cedar_graphqlOptions = cond ? config : { sadness: true }',
    )
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('extracts options from a nested call expression', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      function wrap() {
        const h = createGraphQLHandler({ a: 1 })
        return h
      }
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain('  export const __cedar_graphqlOptions = { a: 1 }')
    expect(result).toContain('createGraphQLHandler(__cedar_graphqlOptions)')
  })

  it('preserves escaped backslashes in string values', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        pattern: "foo\\\\\\\\bar",
        directives,
      })
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain('pattern: "foo\\\\\\\\bar"')
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('returns null when the file has no createGraphQLHandler import', () => {
    const code = `export const handler = something()`

    expect(applyGraphqlOptionsExtract(code)).toBeNull()
  })

  it('returns null when already transformed', () => {
    const code = `export const __cedar_graphqlOptions = {}
export const handler = createGraphQLHandler(__cedar_graphqlOptions)`

    expect(applyGraphqlOptionsExtract(code)).toBeNull()
  })

  it('returns null when there are multiple createGraphQLHandler calls', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const a = createGraphQLHandler({ x: 1 })
      export const b = createGraphQLHandler({ y: 2 })
    `

    expect(applyGraphqlOptionsExtract(code)).toBeNull()
  })

  it('extracts a conditional (ternary) options argument with a member-expression condition', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      const config = {
        directives,
        services,
        onException() {
          db.$disconnect()
        },
      }

      export const handler = createGraphQLHandler(process.env.EVIL ? config : { sadness: true })
    `

    const result = applyGraphqlOptionsExtract(code)

    // The plugin preserves the original source formatting (single-line here).
    expect(result).toContain(
      'export const __cedar_graphqlOptions = process.env.EVIL ? config : { sadness: true }',
    )
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('transforms a graphql.js handler (JS projects)', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        directives,
        sdls,
        services,
      })
    `

    const result = applyGraphqlOptionsExtract(code)

    expect(result).toContain('export const __cedar_graphqlOptions = {')
    expect(result).toContain(
      'export const handler = createGraphQLHandler(__cedar_graphqlOptions)',
    )
  })

  it('preserves original source-map line info through a downstream build', async () => {
    // The transform inserts `export const __cedar_graphqlOptions = ...` on a new
    // line above the handler, which shifts everything below it by one. Because
    // the transform is a verbatim superset of the user's file and esbuild keys
    // the emitted map on the source *filename* (graphql.ts), the final map must
    // still resolve to the user's original line numbers, not the shifted
    // (transformed) ones. This guards against debugger stepping and stack
    // traces pointing at the wrong line after the move to oxc/Vite.
    const code = [
      "import { createGraphQLHandler } from '@cedarjs/graphql-server'",
      "import { db } from 'src/lib/db'",
      '',
      'export const OTHER = 1',
      '',
      'export const handler = createGraphQLHandler({', // user line 6
      '  loggerConfig: { logger, options: {} },', // user line 7
      '  db,',
      '})',
      '',
    ].join('\n')

    const transformed = applyGraphqlOptionsExtract(code)
    expect(transformed).not.toBeNull()

    // Simulate the esbuild onLoad path returning the transformed code with no
    // source map of its own (map: null), exactly as cedarApiGraphqlPlugin does.
    const { code: dist, map } = await transform(transformed!, {
      loader: 'js',
      sourcefile: 'graphql.ts',
      sourcemap: 'external',
    })

    const tracer = new TraceMap(map)
    const distLines = dist.split('\n')
    const distLineIndex = distLines.findIndex((line) =>
      line.includes('loggerConfig'),
    )
    expect(distLineIndex).toBeGreaterThan(0)

    const column = distLines[distLineIndex].indexOf('loggerConfig')
    const original = originalPositionFor(tracer, {
      line: distLineIndex + 1,
      column,
    })

    // loggerConfig lives on user line 7, not the transformed line 8.
    expect(original.source).toBe('graphql.ts')
    expect(original.line).toBe(7)
  })
})
