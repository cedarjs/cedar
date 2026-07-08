import { transformSync } from '@babel/core'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { moduleRunnerTransform as ssrTransform } from 'vite'
import { describe, it, expect } from 'vitest'

import handlerAlsWrappingPlugin from '@cedarjs/babel-config/dist/plugins/babel-plugin-handler-als-wrapping.js'

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
  '  context,',
  ') => {',
  '  const authHandler = new DbAuthHandler(event, context, {',
  '    db: db,',
  '  })',
  '  return await authHandler.invoke()',
  '}',
  '',
].join('\n')

function assertMapsToSource(
  codeLines: string[],
  tracer: TraceMap,
  searchString: string,
  expectedLine: number,
) {
  const lineIdx = codeLines.findIndex((l) => l.includes(searchString))
  expect(lineIdx).toBeGreaterThanOrEqual(0)

  const col = codeLines[lineIdx].indexOf(searchString)
  expect(col).toBeGreaterThanOrEqual(0)

  const original = originalPositionFor(tracer, {
    line: lineIdx + 1,
    column: col,
  })
  expect(original.line).toBe(expectedLine)
}

describe('Vite SSR source map chain', () => {
  it('maps SSR output to correct source lines after SSR transform', async () => {
    const babelResult = transformSync(simpleHandlerInput, {
      filename: 'graphql.ts',
      plugins: [[handlerAlsWrappingPlugin, {}]],
      sourceMaps: true,
      sourceFileName: 'graphql.ts',
      configFile: false,
      babelrc: false,
    })

    // Simulate the enforce:'pre' behavior: Babel input matches originalCode
    const ssrResult = await ssrTransform(
      babelResult!.code!,
      babelResult!.map as any,
      '/api/src/functions/graphql.ts',
      simpleHandlerInput,
    )

    expect(ssrResult).not.toBeNull()
    expect(ssrResult!.map).toBeDefined()
    expect(ssrResult!.map!.mappings).toBeTruthy()

    const tracer = new TraceMap(ssrResult!.map!)
    const codeLines = ssrResult.code.split('\n')

    // createGraphQLHandler appears in Vite's import metadata ("importedNames")
    // which was generated from the original import statement on line 2
    assertMapsToSource(codeLines, tracer, 'createGraphQLHandler', 2)

    // createGraphQLHandler)({ uniquely matches the handler call on SSR line 6.
    // It should trace back to the handler call on original line 4.
    assertMapsToSource(codeLines, tracer, 'createGraphQLHandler)({', 4)
  })

  it('maps async handler body to correct source lines after SSR', async () => {
    const babelResult = transformSync(asyncHandlerInput, {
      filename: 'auth.ts',
      plugins: [[handlerAlsWrappingPlugin, {}]],
      sourceMaps: true,
      sourceFileName: 'auth.ts',
      configFile: false,
      babelrc: false,
    })

    const ssrResult = await ssrTransform(
      babelResult!.code!,
      babelResult!.map as any,
      '/api/src/functions/auth.ts',
      asyncHandlerInput,
    )

    expect(ssrResult).not.toBeNull()
    expect(ssrResult!.map).toBeDefined()

    const tracer = new TraceMap(ssrResult!.map!)
    const codeLines = ssrResult.code.split('\n')

    // DbAuthHandler constructor call maps to original line 8
    assertMapsToSource(codeLines, tracer, '.DbAuthHandler(', 8)
    // return await authHandler.invoke() maps to original line 11
    assertMapsToSource(codeLines, tracer, 'authHandler.invoke', 11)
  })
})
