import { dedent } from 'ts-dedent'
import { describe, it, expect } from 'vitest'

import { cedarGraphqlOptionsExtractPlugin } from '../vite-plugin-cedar-graphql-options-extract'

const plugin = cedarGraphqlOptionsExtractPlugin()

describe('cedarGraphqlOptionsExtractPlugin', () => {
  it('extracts options from createGraphQLHandler call', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      import directives from 'src/directives/**/*.{js,ts}'
      import sdls from 'src/graphql/**/*.sdl.{js,ts}'
      import services from 'src/services/**/*.{js,ts}'

      import { db } from 'src/lib/db'
      import { logger } from 'src/lib/logger'

      export const handler = createGraphQLHandler({
        loggerConfig: { logger, options: {} },
        directives,
        sdls,
        services,
        onException: () => {
          db.$disconnect()
        },
      })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      // Should have extracted options
      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      // Should have the object content
      expect(transformed).toContain('loggerConfig:')
      // Should reference the extracted options
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('extracts simple object literal options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        directives,
        sdls,
        services,
      })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('extracts variable reference options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      const options = { directives, sdls }

      export const handler = createGraphQLHandler(options)
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain(
        'export const __cedar_graphqlOptions = options',
      )
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('handles function call options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler(buildOptions())
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain(
        'export const __cedar_graphqlOptions = buildOptions()',
      )
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('skips files without createGraphQLHandler', () => {
    const code = dedent`
      import { something } from 'some-module'

      export const handler = something()
    `

    const result = plugin.transform!(code, 'other.ts')
    expect(result).toBeNull()
  })

  it('skips files already transformed', () => {
    const code = dedent`
      export const __cedar_graphqlOptions = { /* ... */ }
      export const handler = createGraphQLHandler(__cedar_graphqlOptions)
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('preserves formatting and other code', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      import directives from 'src/directives/**/*.{js,ts}'
      import sdls from 'src/graphql/**/*.sdl.{js,ts}'
      import services from 'src/services/**/*.{js,ts}'

      import { db } from 'src/lib/db'
      import { logger } from 'src/lib/logger'

      export const handler = createGraphQLHandler({
        loggerConfig: { logger, options: {} },
        directives,
        sdls,
        services,
        onException: () => {
          // Disconnect from your database with an unhandled exception.
          db.$disconnect()
        },
      })

      // Additional code after handler
      export const somethingElse = 123
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      // Should preserve imports
      expect(transformed).toContain('import { createGraphQLHandler }')
      expect(transformed).toContain('import directives from')
      // Should preserve additional code
      expect(transformed).toContain('export const somethingElse = 123')
      // Should have extracted options
      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
    }
  })

  it('handles nested object literals in options', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        loggerConfig: { logger, options: { nested: { deeply: true } } },
        directives,
      })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain('nested: { deeply: true }')
    }
  })

  it('handles escaped backslashes in string values', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        pattern: "foo\\\\\\\\bar",
        directives,
      })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      // Should correctly extract the entire options object despite escaped backslashes
      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain('pattern:')
      expect(transformed).toContain('directives,')
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('preserves newlines between handler and following code', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({
        directives,
      })
      export const config = { wrapped: true }
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      // Verify the transformation
      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
      // Verify newline is preserved (not joined without separator)
      // If the newline wasn't preserved, we'd see ')export' without a newline
      expect(transformed).toContain(')\nexport const config')
      // Verify there's no syntax error pattern of joining without separator
      expect(transformed).not.toMatch(/\)\w/)
    }
  })

  it('handles aliased imports of createGraphQLHandler', () => {
    const code = dedent`
      import { createGraphQLHandler as someOther } from '@cedarjs/graphql-server'

      const graphQLHandler = someOther({
        directives,
      })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain('someOther(__cedar_graphqlOptions)')
    }
  })

  it('handles nested createGraphQLHandler calls', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      function wrap() {
        const h = createGraphQLHandler({
          directives,
        })
        return h
      }
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('returns null for multiple createGraphQLHandler calls', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const a = createGraphQLHandler({ x: 1 })
      export const b = createGraphQLHandler({ y: 2 })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
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
        extraPlugins: [
          {
            name: 'test',
            function: () => { console.log('test') },
          },
        ],
      }

      export const handler = createGraphQLHandler(process.env.EVIL ? config : { sadness: true })
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      // The whole ternary (member-expression condition + object alternate)
      // should be extracted verbatim as the options value. The plugin preserves
      // the original source formatting (single-line here), unlike the babel
      // plugin which pretty-printed the result.
      expect(transformed).toContain(
        'export const __cedar_graphqlOptions = process.env.EVIL ? config : { sadness: true }',
      )
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
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

    const result = plugin.transform!(code, 'api/src/functions/graphql.js')

    expect(result).not.toBeNull()
    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })
})
