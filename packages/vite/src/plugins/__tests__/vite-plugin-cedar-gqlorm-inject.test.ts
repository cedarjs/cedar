import fs from 'node:fs'

import { dedent } from 'ts-dedent'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type { Paths } from '@cedarjs/project-config'
import type * as ProjectConfig from '@cedarjs/project-config'
import { DEFAULT_CONFIG, getConfig, getPaths } from '@cedarjs/project-config'

import { cedarGqlormInjectPlugin } from '../vite-plugin-cedar-gqlorm-inject'

// Mock the getConfig and getPaths functions while preserving real exports like DEFAULT_CONFIG
vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const original = await importOriginal<typeof ProjectConfig>()
  return {
    ...original,
    getConfig: vi.fn(),
    getPaths: vi.fn(),
  }
})

const plugin = cedarGqlormInjectPlugin()

describe('cedarGqlormInjectPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('injects gqlorm backend when enabled and backend file exists', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      import directives from 'src/directives/**/*.{js,ts}'
      import sdls from 'src/graphql/**/*.sdl.{js,ts}'
      import services from 'src/services/**/*.{js,ts}'

      export const handler = createGraphQLHandler({
        directives,
        sdls,
        services,
      })
    `

    // Mock config and paths
    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        gqlorm: { ...DEFAULT_CONFIG.experimental.gqlorm, enabled: true },
      },
    })
    vi.mocked(getPaths).mockReturnValue({
      generated: { base: '.cedar' },
      api: { src: 'api/src', jobs: 'api/src/jobs' },
    } as unknown as Paths)

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
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({})
    `

    // Mock config with gqlorm disabled
    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        gqlorm: { ...DEFAULT_CONFIG.experimental.gqlorm, enabled: false },
      },
    })

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('skips transformation when backend file does not exist', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({})
    `

    // Mock config with gqlorm enabled
    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        gqlorm: { ...DEFAULT_CONFIG.experimental.gqlorm, enabled: true },
      },
    })
    vi.mocked(getPaths).mockReturnValue({
      generated: { base: '.cedar' },
    } as unknown as Paths)

    // Mock backend file does not exist
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('skips non-graphql files', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({})
    `

    const result = plugin.transform!(code, 'api/src/functions/other.ts')
    expect(result).toBeNull()
  })

  it('skips files without createGraphQLHandler', () => {
    const code = dedent`
      import { something } from 'some-module'

      export const handler = something({})
    `

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('preserves other imports and code', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'
      import directives from 'src/directives/**/*.{js,ts}'
      import sdls from 'src/graphql/**/*.sdl.{js,ts}'

      export const handler = createGraphQLHandler({
        directives,
        sdls,
      })

      export function someOtherExport() {
        return 'something'
      }
    `

    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        gqlorm: { ...DEFAULT_CONFIG.experimental.gqlorm, enabled: true },
      },
    })
    vi.mocked(getPaths).mockReturnValue({
      generated: { base: '.cedar' },
      api: { src: 'api/src' },
    } as unknown as Paths)

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
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({})
    `

    vi.mocked(getConfig).mockImplementation(() => {
      throw new Error('Config not found')
    })

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('handles missing getPaths', () => {
    const code = dedent`
      import { createGraphQLHandler } from '@cedarjs/graphql-server'

      export const handler = createGraphQLHandler({})
    `

    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        gqlorm: { ...DEFAULT_CONFIG.experimental.gqlorm, enabled: true },
      },
    })
    vi.mocked(getPaths).mockImplementation(() => {
      throw new Error('Paths not found')
    })

    const result = plugin.transform!(code, 'api/src/functions/graphql.ts')
    expect(result).toBeNull()
  })

  it('correctly handles multi-line imports', () => {
    const code = dedent`
      import {
        createGraphQLHandler,
        type GraphQLHandlerOptions,
      } from '@cedarjs/graphql-server'
      import { db } from 'src/lib/db'

      export const handler = createGraphQLHandler({
        db,
      })
    `

    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        gqlorm: { ...DEFAULT_CONFIG.experimental.gqlorm, enabled: true },
      },
    })
    vi.mocked(getPaths).mockReturnValue({
      generated: { base: '.cedar' },
      api: { src: 'api/src' },
    } as unknown as Paths)

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
