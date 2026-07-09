import fs from 'node:fs'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { getConfig, getPaths } from '@cedarjs/project-config'

import { cedarGqlormInjectPlugin } from '../vite-plugin-cedar-gqlorm-inject'

// Mock the getConfig and getPaths functions
vi.mock('@cedarjs/project-config', () => ({
  getConfig: vi.fn(),
  getPaths: vi.fn(),
}))

const plugin = cedarGqlormInjectPlugin()

describe('cedarGqlormInjectPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('injects gqlorm backend when enabled and backend file exists', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

import directives from 'src/directives/**/*.{js,ts}'
import sdls from 'src/graphql/**/*.sdl.{js,ts}'
import services from 'src/services/**/*.{js,ts}'

export const handler = createGraphQLHandler({
  directives,
  sdls,
  services,
})`

    // Mock config and paths
    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: true } },
    })
    ;(getPaths as any).mockReturnValue({
      generated: { base: '.cedar' },
      api: { jobs: 'api/src/jobs' },
    })

    // Mock backend file existence
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    if (result && typeof result === 'object') {
      const transformed = result.code

      // Should have injected imports
      expect(transformed).toContain('import { db as __gqlorm_db__ }')
      expect(transformed).toContain('import * as __gqlorm_sdl__')

      // Should have injected Object.assign
      expect(transformed).toContain('Object.assign(sdls, {')
      expect(transformed).toContain('__gqlorm__:')
      expect(transformed).toContain('schema: __gqlorm_sdl__.schema')
      expect(transformed).toContain(
        'resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__)',
      )

      // Should still have the handler
      expect(transformed).toContain(
        'export const handler = createGraphQLHandler',
      )
    }
  })

  it('skips transformation when gqlorm is disabled', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({})`

    // Mock config with gqlorm disabled
    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: false } },
    })

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('skips transformation when backend file does not exist', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({})`

    // Mock config with gqlorm enabled
    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: true } },
    })
    ;(getPaths as any).mockReturnValue({
      generated: { base: '.cedar' },
    })

    // Mock backend file does not exist
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('skips non-graphql files', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({})`

    const result = plugin.transform!(code, 'api/src/functions/other.ts')
    expect(result).toBeNull()
  })

  it('skips files without createGraphQLHandler', () => {
    const code = `import { something } from 'some-module'

export const handler = something({})`

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('handles TypeScript graphql.tsx files', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({})`

    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: true } },
    })
    ;(getPaths as any).mockReturnValue({
      generated: { base: '.cedar' },
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)

    const result = plugin.transform!(code, 'api/src/functions/graphql.tsx')

    if (result && typeof result === 'object') {
      expect(result.code).toContain('Object.assign(sdls, {')
    }
  })

  it('preserves other imports and code', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'
import directives from 'src/directives/**/*.{js,ts}'
import sdls from 'src/graphql/**/*.sdl.{js,ts}'

export const handler = createGraphQLHandler({
  directives,
  sdls,
})

export function someOtherExport() {
  return 'something'
}`

    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: true } },
    })
    ;(getPaths as any).mockReturnValue({
      generated: { base: '.cedar' },
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    if (result && typeof result === 'object') {
      const transformed = result.code

      // Should preserve original imports
      expect(transformed).toContain('import directives from')
      expect(transformed).toContain('import sdls from')

      // Should preserve other exports
      expect(transformed).toContain('export function someOtherExport')
    }
  })

  it('handles missing getConfig', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({})`

    ;(getConfig as any).mockImplementation(() => {
      throw new Error('Config not found')
    })

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('handles missing getPaths', () => {
    const code = `import { createGraphQLHandler } from '@cedarjs/graphql-server'

export const handler = createGraphQLHandler({})`

    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: true } },
    })
    ;(getPaths as any).mockImplementation(() => {
      throw new Error('Paths not found')
    })

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('correctly handles multi-line imports', () => {
    const code = `import {
  createGraphQLHandler,
  type GraphQLHandlerOptions,
} from '@cedarjs/graphql-server'
import { db } from 'src/lib/db'

export const handler = createGraphQLHandler({
  db,
})`

    ;(getConfig as any).mockReturnValue({
      experimental: { gqlorm: { enabled: true } },
    })
    ;(getPaths as any).mockReturnValue({
      generated: { base: '.cedar' },
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')

    if (result && typeof result === 'object') {
      const transformed = result.code

      // Verify the gqlorm injections are present
      expect(transformed).toContain('__gqlorm_sdl__')
      expect(transformed).toContain('Object.assign(sdls')
      expect(transformed).toContain('import { db as __gqlorm_db__ }')

      // Verify the multi-line import is still valid (not broken by injection)
      expect(transformed).toContain("} from '@cedarjs/graphql-server'")
      expect(transformed).toContain("import { db } from 'src/lib/db'")
    }
  })
})
