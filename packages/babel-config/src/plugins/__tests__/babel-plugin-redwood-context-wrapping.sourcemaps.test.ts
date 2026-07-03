import { transformSync } from '@babel/core'
import type { PluginItem } from '@babel/core'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import type { EncodedSourceMap } from '@jridgewell/trace-mapping'
import type { SourceMap } from 'rollup'
import { moduleRunnerTransform as ssrTransform } from 'vite'
import { describe, it, expect } from 'vitest'

import gqlormInjectPlugin from '../babel-plugin-cedar-gqlorm-inject'
import graphqlOptionsExtractPlugin from '../babel-plugin-cedar-graphql-options-extract'
import plugin from '../babel-plugin-redwood-context-wrapping'

const simpleHandlerInput = [
  '',
  "import { createGraphQLHandler } from '@cedarjs/graphql-server'",
  '',
  'export const handler = createGraphQLHandler({',
  '  loggerConfig: { logger, options: {} },',
  '  sdls,',
  '  services,',
  '})',
  '',
].join('\n')

const asyncHandlerInput = [
  '',
  "import { DbAuthHandler } from '@cedarjs/auth-dbauth-api'",
  '',
  'export const handler = async (',
  '  event,',
  '  context',
  ') => {',
  '  const authHandler = new DbAuthHandler(event, context, {',
  '    db: db,',
  '  })',
  '  return await authHandler.invoke()',
  '}',
  '',
].join('\n')

const graphqlHandlerInput = [
  '',
  "import { authDecoder } from '@cedarjs/auth-dbauth-api'",
  "import { createGraphQLHandler } from '@cedarjs/graphql-server'",
  '',
  "import { getCurrentUser } from 'src/lib/auth'",
  "import { db } from 'src/lib/db'",
  "import { logger } from 'src/lib/logger'",
  '',
  'export const handler = createGraphQLHandler({',
  '  authDecoder,',
  '  getCurrentUser,',
  '  loggerConfig: { logger, options: {} },',
  '  directives,',
  '  sdls,',
  '  services,',
  '})',
  '',
].join('\n')

function runBabelTransform(
  input: string,
  filename: string,
  plugins: PluginItem[] = [[plugin, {}]],
) {
  return transformSync(input, {
    filename,
    plugins,
    sourceMaps: true,
    sourceFileName: filename,
    configFile: false,
    babelrc: false,
  })
}

function isEncodedSourceMap(value: unknown): value is EncodedSourceMap {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    !('mappings' in value) ||
    !('sources' in value) ||
    !('names' in value)
  ) {
    return false
  }

  return (
    typeof value.version === 'number' &&
    typeof value.mappings === 'string' &&
    Array.isArray(value.sources) &&
    Array.isArray(value.names)
  )
}

function getCodeAndMap(result: ReturnType<typeof transformSync>): {
  code: string
  map: EncodedSourceMap
} {
  if (!result) {
    throw new Error('Expected Babel transform to return a result')
  }
  if (!result.code) {
    throw new Error('Expected Babel transform to produce code')
  }

  const babelMap = result.map
  if (!isEncodedSourceMap(babelMap)) {
    throw new Error('Expected Babel transform to produce a valid source map')
  }

  return { code: result.code, map: babelMap }
}

function getSsrCodeAndMap(result: Awaited<ReturnType<typeof ssrTransform>>): {
  code: string
  map: EncodedSourceMap
} {
  if (!result) {
    throw new Error('Expected SSR transform to return a result')
  }

  if (!result.code) {
    throw new Error('Expected SSR transform to produce code')
  }

  const ssrMap = result.map
  if (!isEncodedSourceMap(ssrMap)) {
    throw new Error('Expected SSR transform to produce a valid source map')
  }

  return { code: result.code, map: ssrMap }
}

/**
 * Constructs a proper Rollup SourceMap from an EncodedSourceMap.
 * ssrTransform only reads data properties (mappings, sources, etc.)
 * at runtime and never calls toString()/toUrl(). We provide minimal
 * implementations to satisfy the SourceMap interface.
 */
function asSourceMap(map: EncodedSourceMap): SourceMap {
  return {
    file: map.file ?? '',
    mappings: map.mappings,
    names: map.names,
    sources: map.sources.filter((s): s is string => s !== null),
    sourcesContent: map.sourcesContent?.filter((s): s is string => s !== null),
    version: map.version,
    toString: () => map.mappings,
    toUrl: () => map.mappings,
  }
}

function assertMapsToSource(
  codeLines: string[],
  tracer: TraceMap,
  searchString: string,
  expectedSource: string,
  expectedLine: number,
) {
  const lineIndex = codeLines.findIndex((line) => line.includes(searchString))
  expect(lineIndex).toBeGreaterThanOrEqual(0)

  const col = codeLines[lineIndex].indexOf(searchString)
  expect(col).toBeGreaterThanOrEqual(0)

  const original = originalPositionFor(tracer, {
    line: lineIndex + 1,
    column: col,
  })
  expect(original.source).toBe(expectedSource)
  expect(original.line).toBe(expectedLine)
}

describe('babel-plugin-redwood-context-wrapping source maps', () => {
  it('produces a source map with the expected structure', () => {
    const { code, map } = getCodeAndMap(
      runBabelTransform(simpleHandlerInput, 'graphql.ts'),
    )

    expect(map.sources).toContain('graphql.ts')
    expect(map.mappings).toBeTruthy()
    expect(map.sourcesContent).toBeDefined()
    expect(map.sourcesContent?.[0]).toBe(simpleHandlerInput)
    expect(map.version).toBe(3)

    // code should contain the wrapped handler
    expect(code).toContain('__rw_handler')
  })

  it('maps __rw_handler back to the original handler declaration line', () => {
    const { code, map } = getCodeAndMap(
      runBabelTransform(simpleHandlerInput, 'graphql.ts'),
    )

    const tracer = new TraceMap(map)
    const codeLines = code.split('\n')

    // __rw_handler = is unique to the handler copy - search for that prefix
    // then find createGraphQLHandler within that same line.
    const rwLineIndex = codeLines.findIndex((line) =>
      line.includes('__rw_handler ='),
    )
    expect(rwLineIndex).toBeGreaterThan(0)

    const col = codeLines[rwLineIndex].indexOf('createGraphQLHandler')
    expect(col).toBeGreaterThan(0)

    const original = originalPositionFor(tracer, {
      line: rwLineIndex + 1,
      column: col,
    })
    // original line 4 (1-indexed) = export const handler = createGraphQLHandler({
    // (1: empty, 2: import, 3: empty, 4: export ...)
    expect(original.source).toBe('graphql.ts')
    expect(original.line).toBe(4)
  })

  it('maps async handler body content to original source lines', () => {
    const { code, map } = getCodeAndMap(
      runBabelTransform(asyncHandlerInput, 'auth.ts'),
    )

    const tracer = new TraceMap(map)
    const codeLines = code.split('\n')

    // new DbAuthHandler in __rw_handler should map back to line 8
    assertMapsToSource(codeLines, tracer, 'new DbAuthHandler', 'auth.ts', 8)

    // return await authHandler.invoke() should map back to line 11
    assertMapsToSource(
      codeLines,
      tracer,
      'return await authHandler.invoke',
      'auth.ts',
      11,
    )
  })

  it('does not collapse all mappings to line 1', () => {
    const { code, map } = getCodeAndMap(
      runBabelTransform(simpleHandlerInput, 'graphql.ts'),
    )

    const tracer = new TraceMap(map)
    const codeLines = code.split('\n')
    const linesWithValidOrigin = new Set<number>()

    for (let line = 1; line <= codeLines.length; line++) {
      const original = originalPositionFor(tracer, { line, column: 0 })
      if (original.line !== null && original.line > 0) {
        linesWithValidOrigin.add(original.line)
      }
    }

    const maxMappedLine = Math.max(...linesWithValidOrigin)
    expect(maxMappedLine).toBeGreaterThan(1)
  })

  describe('multi-plugin interaction', () => {
    it('maps correctly when graphql-options-extract + context-wrapping both apply', () => {
      // This is the exact plugin list that runs on the graphql function:
      // 1. graphqlOptionsExtract - extracts options into __cedar_graphqlOptions
      // 2. gqlormInject - injects gqlorm backend (no-op without config)
      // 3. context-wrapping - wraps handler with async store isolation
      //
      // graphql-options-extract creates a new export node, and context-wrapping
      // copies the handler init. If either mishandles source locations, the
      // combined source map will be wrong.
      const { code, map } = getCodeAndMap(
        runBabelTransform(graphqlHandlerInput, 'api/src/functions/graphql.ts', [
          graphqlOptionsExtractPlugin,
          gqlormInjectPlugin,
          [plugin, {}],
        ]),
      )

      const tracer = new TraceMap(map)
      const codeLines = code.split('\n')

      // The output should have __cedar_graphqlOptions (from options-extract)
      expect(code).toContain('__cedar_graphqlOptions')

      // And __rw_handler (from context-wrapping)
      expect(code).toContain('__rw_handler')

      // The __cedar_graphqlOptions variable `{` should map to the original
      // createGraphQLHandler options object on line 9.
      const optsLineIndex = codeLines.findIndex((line) =>
        line.includes('__cedar_graphqlOptions'),
      )
      expect(optsLineIndex).toBeGreaterThan(0)

      const optsCol = codeLines[optsLineIndex].indexOf('{')
      expect(optsCol).toBeGreaterThan(0)
      const optsOriginal = originalPositionFor(tracer, {
        line: optsLineIndex + 1,
        column: optsCol,
      })
      expect(optsOriginal.source).toBe('api/src/functions/graphql.ts')
      expect(optsOriginal.line).toBe(9)

      // createGraphQLHandler in __rw_handler should map back to line 9.
      const rwLineIndex = codeLines.findIndex((line) =>
        line.includes('__rw_handler ='),
      )
      expect(rwLineIndex).toBeGreaterThan(0)
      const rwCol = codeLines[rwLineIndex].indexOf('createGraphQLHandler')
      expect(rwCol).toBeGreaterThan(0)
      const rwOriginal = originalPositionFor(tracer, {
        line: rwLineIndex + 1,
        column: rwCol,
      })
      expect(rwOriginal.source).toBe('api/src/functions/graphql.ts')
      expect(rwOriginal.line).toBe(9)

      // The import added by context-wrapping should not break other mappings.
      // authDecoder from the original import should still map to line 2.
      assertMapsToSource(
        codeLines,
        tracer,
        'authDecoder',
        'api/src/functions/graphql.ts',
        2,
      )
    })
  })

  describe('Vite SSR transform chaining', () => {
    // This is the actual pipeline Vite uses for API files:
    // 1. Babel transforms the source (plugin transform hook) - returns { code, map }
    // 2. Vite normalizes the map (injectSourcesContent, normalize sources paths)
    // 3. ssrTransform rewrites ESM to SSR format (MagicString + combineSourcemaps)

    it('maps __rw_handler to the original source after full SSR transform', async () => {
      const { code, map } = getCodeAndMap(
        runBabelTransform(simpleHandlerInput, 'graphql.ts'),
      )

      const ssrResult = await ssrTransform(
        code,
        asSourceMap(map),
        '/api/src/functions/graphql.ts',
        simpleHandlerInput,
      )

      const { code: ssrCode, map: ssrMap } = getSsrCodeAndMap(ssrResult)
      const tracer = new TraceMap(ssrMap)
      const codeLines = ssrCode.split('\n')

      // __rw_handler = should be present in SSR output
      const rwLineIndex = codeLines.findIndex((line) =>
        line.includes('__rw_handler ='),
      )
      expect(rwLineIndex).toBeGreaterThan(0)

      const col = codeLines[rwLineIndex].indexOf('createGraphQLHandler')
      expect(col).toBeGreaterThan(0)

      const original = originalPositionFor(tracer, {
        line: rwLineIndex + 1,
        column: col,
      })

      // Should trace back to original source, line 4
      expect(original.source).toBeTruthy()
      expect(original.line).toBe(4)
    })

    it('maps async handler body to original source after SSR transform', async () => {
      const { code, map } = getCodeAndMap(
        runBabelTransform(asyncHandlerInput, 'auth.ts'),
      )

      const ssrResult = await ssrTransform(
        code,
        asSourceMap(map),
        '/api/src/functions/auth.ts',
        asyncHandlerInput,
      )

      const { code: ssrCode, map: ssrMap } = getSsrCodeAndMap(ssrResult)
      const tracer = new TraceMap(ssrMap)
      const codeLines = ssrCode.split('\n')

      // SSR rewrites `new DbAuthHandler` to `new __vite_ssr_import_0__.DbAuthHandler`,
      // so search for the class name fragment that survived the rewrite.
      const dbAuthLineIndex = codeLines.findIndex((line) =>
        line.includes('.DbAuthHandler('),
      )
      expect(dbAuthLineIndex).toBeGreaterThan(0)
      // Find the column of 'DbAuthHandler' within the SSR-rewritten expression
      const dbAuthCol = codeLines[dbAuthLineIndex].indexOf('DbAuthHandler')
      expect(dbAuthCol).toBeGreaterThan(0)

      const original = originalPositionFor(tracer, {
        line: dbAuthLineIndex + 1,
        column: dbAuthCol,
      })
      expect(original.line).toBe(8)
    })

    it('maps multi-plugin output correctly after SSR transform', async () => {
      const { code, map } = getCodeAndMap(
        runBabelTransform(graphqlHandlerInput, 'api/src/functions/graphql.ts', [
          graphqlOptionsExtractPlugin,
          gqlormInjectPlugin,
          [plugin, {}],
        ]),
      )

      const ssrResult = await ssrTransform(
        code,
        asSourceMap(map),
        '/api/src/functions/graphql.ts',
        graphqlHandlerInput,
      )

      const { code: ssrCode, map: ssrMap } = getSsrCodeAndMap(ssrResult)
      const tracer = new TraceMap(ssrMap)
      const codeLines = ssrCode.split('\n')

      // After SSR transform, __cedar_graphqlOptions and __rw_handler should
      // still map back to their original source lines.
      // SSR prepends __vite_ssr_exportName__ declarations, so the actual
      // definition (const __cedar_graphqlOptions = {) is on a later line.
      const optsLineIndex = codeLines.findIndex((line) =>
        line.includes('const __cedar_graphqlOptions'),
      )
      expect(optsLineIndex).toBeGreaterThan(0)

      const optsCol = codeLines[optsLineIndex].indexOf('{')
      expect(optsCol).toBeGreaterThan(0)
      const optsOriginal = originalPositionFor(tracer, {
        line: optsLineIndex + 1,
        column: optsCol,
      })
      expect(optsOriginal.source).toBeTruthy()
      // Should map to line 9, the original createGraphQLHandler({ line
      expect(optsOriginal.line).toBe(9)

      // __rw_handler = createGraphQLHandler should map to line 9.
      // SSR rewrites createGraphQLHandler to (0,__vite_ssr_import_1__.createGraphQLHandler).
      const rwLineIndex = codeLines.findIndex((line) =>
        line.includes('__rw_handler ='),
      )
      expect(rwLineIndex).toBeGreaterThan(0)
      const rwCol = codeLines[rwLineIndex].indexOf('createGraphQLHandler')
      expect(rwCol).toBeGreaterThan(0)
      const rwOriginal = originalPositionFor(tracer, {
        line: rwLineIndex + 1,
        column: rwCol,
      })
      expect(rwOriginal.line).toBe(9)

      // authDecoder identifier in the import declaration line gets rewritten
      // by SSR, so we search for the property shorthand that came from the
      // original options object (authDecoder: __vite_ssr_import_0__.authDecoder)
      // which should map back to original line 10 (where authDecoder appears
      // as a property in the handler options).
      const decoderLineIndex = codeLines.findIndex((line) =>
        line.includes('authDecoder: __vite_ssr_import_0__.authDecoder'),
      )
      expect(decoderLineIndex).toBeGreaterThan(0)
      const decoderCol = codeLines[decoderLineIndex].indexOf('authDecoder:')
      expect(decoderCol).toBeGreaterThanOrEqual(0)
      const decoderOriginal = originalPositionFor(tracer, {
        line: decoderLineIndex + 1,
        column: decoderCol,
      })
      expect(decoderOriginal.source).toBeTruthy()
      // The authDecoder property shorthand came from the original options
      // object on line 10 (1-indexed: authDecoder,)
      expect(decoderOriginal.line).toBe(10)
    })
  })
})
