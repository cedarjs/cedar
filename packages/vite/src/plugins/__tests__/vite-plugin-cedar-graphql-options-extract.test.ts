import { describe, it, expect } from 'vitest'

import { cedarGraphqlOptionsExtractPlugin } from '../vite-plugin-cedar-graphql-options-extract'

const plugin = cedarGraphqlOptionsExtractPlugin()

describe('cedarGraphqlOptionsExtractPlugin', () => {
  it('extracts options from createGraphQLHandler call', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

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
})`

    const result = plugin.transform!(code, 'graphql.ts')

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
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({
  directives,
  sdls,
  services,
})`

    const result = plugin.transform!(code, 'graphql.ts')

    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain(
        'createGraphQLHandler(__cedar_graphqlOptions)',
      )
    }
  })

  it('extracts variable reference options', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

const options = { directives, sdls }

export const handler = createGraphQLHandler(options)`

    const result = plugin.transform!(code, 'graphql.ts')

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
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler(buildOptions())`

    const result = plugin.transform!(code, 'graphql.ts')

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
    const code = `import { something } from 'some-module'

export const handler = something()`

    const result = plugin.transform!(code, 'other.ts')
    expect(result).toBeNull()
  })

  it('skips files already transformed', () => {
    const code = `export const __cedar_graphqlOptions = { /* ... */ }
export const handler = createGraphQLHandler(__cedar_graphqlOptions)`

    const result = plugin.transform!(code, 'graphql.ts')
    expect(result).toBeNull()
  })

  it('preserves formatting and other code', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

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
export const somethingElse = 123`

    const result = plugin.transform!(code, 'graphql.ts')

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
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({
  loggerConfig: { logger, options: { nested: { deeply: true } } },
  directives,
})`

    const result = plugin.transform!(code, 'graphql.ts')

    if (result && typeof result === 'object') {
      const transformed = result.code

      expect(transformed).toContain('export const __cedar_graphqlOptions = {')
      expect(transformed).toContain('nested: { deeply: true }')
    }
  })

  it('handles escaped backslashes in string values', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({
  pattern: "foo\\\\\\\\bar",
  directives,
})`

    const result = plugin.transform!(code, 'graphql.ts')

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
})
