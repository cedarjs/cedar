import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { describe, expect, it } from 'vitest'

import { generateDiffSourceMap } from '../generateDiffSourceMap.js'

function trace(original: string, transformed: string) {
  const map = generateDiffSourceMap(original, transformed)

  if (!map) {
    throw new Error('Expected a sourcemap')
  }

  const tracer = new TraceMap(JSON.parse(map.toString()))

  // `line` is 1-based, `column` is 0-based (trace-mapping conventions)
  return (line: number, column: number) =>
    originalPositionFor(tracer, { line, column })
}

describe('generateDiffSourceMap', () => {
  it('returns null when nothing changed', () => {
    const code = "import { db } from 'src/lib/db'\n"

    expect(generateDiffSourceMap(code, code)).toBeNull()
  })

  it('maps columns exactly for an in-place specifier rewrite', () => {
    const original = [
      "import { db } from 'src/lib/db'",
      '',
      'export const getUser = () => db.user.findFirst()',
    ].join('\n')
    // `src/lib/db` (10 chars) → `../../lib/db` (12 chars): +2 columns
    const transformed = original.replace('src/lib/db', '../../lib/db')

    const pos = trace(original, transformed)

    // The closing quote sits after the rewritten specifier: column 30 in the
    // original, column 32 in the transformed code
    expect(pos(1, 32)).toMatchObject({ line: 1, column: 30 })
    // Unchanged lines map exactly
    expect(pos(3, 13)).toMatchObject({ line: 3, column: 13 })
  })

  it('maps columns exactly when an extension is appended', () => {
    const original = "import { logger } from '../lib/logger'\nlogger.info()"
    const transformed =
      "import { logger } from '../lib/logger.js'\nlogger.info()"

    const pos = trace(original, transformed)

    // The closing quote: column 37 originally, column 40 after `.js`
    expect(pos(1, 40)).toMatchObject({ line: 1, column: 37 })
    expect(pos(2, 7)).toMatchObject({ line: 2, column: 7 })
  })

  it('maps lines below a pure line insertion', () => {
    const original = [
      "import { logger } from 'src/lib/logger'",
      '',
      'export const handler = () => {',
      '  logger.info("hi")',
      '}',
    ].join('\n')
    const transformed = "import { db } from 'src/lib/db'\n" + original

    const pos = trace(original, transformed)

    // Every original line is shifted down by one in the transformed code
    expect(pos(2, 0)).toMatchObject({ line: 1, column: 0 })
    expect(pos(5, 2)).toMatchObject({ line: 4, column: 2 })
    expect(pos(6, 0)).toMatchObject({ line: 5, column: 0 })
  })

  it('maps lines after a replaced block', () => {
    const original = [
      'const a = 1',
      'export const fn = () => {',
      '  return a',
      '}',
      'const b = 2',
    ].join('\n')
    const transformed = [
      'const a = 1',
      'export const fn = async () => {',
      '  return wrap(() => {',
      '    return a',
      '  })',
      '}',
      'const b = 2',
    ].join('\n')

    const pos = trace(original, transformed)

    // The anchored lines before and after the replaced block map exactly
    expect(pos(1, 6)).toMatchObject({ line: 1, column: 6 })
    expect(pos(7, 6)).toMatchObject({ line: 5, column: 6 })
    // Positions inside the replaced block resolve to its start line
    expect(pos(3, 2).line).toBe(2)
  })

  it('maps lines after a pure line deletion', () => {
    const original = ['const a = 1', 'const gone = 0', 'const b = 2'].join('\n')
    const transformed = ['const a = 1', 'const b = 2'].join('\n')

    const pos = trace(original, transformed)

    expect(pos(1, 6)).toMatchObject({ line: 1, column: 6 })
    expect(pos(2, 6)).toMatchObject({ line: 3, column: 6 })
  })

  it('maps unchanged lines inside a wrapped block (OTel-style)', () => {
    const original = [
      'const a = 1',
      'export const getUser = async ({ id }) => {',
      '  const user = await db.user.findUnique({ where: { id } })',
      '  return user',
      '}',
      'const b = 2',
    ].join('\n')
    // OTel wrapping keeps the original statements verbatim inside the
    // wrapper, shifted down by the inserted lines
    const transformed = [
      'const a = 1',
      'export const getUser = async ({ id }) => {',
      '  return tracer.startActiveSpan("getUser", async () => {',
      '  const user = await db.user.findUnique({ where: { id } })',
      '  return user',
      '  })',
      '}',
      'const b = 2',
    ].join('\n')

    const pos = trace(original, transformed)

    // The unchanged statements inside the wrapper map to their true original
    // lines, not to the start of the wrapped block
    expect(pos(4, 8)).toMatchObject({ line: 3, column: 8 })
    expect(pos(5, 2)).toMatchObject({ line: 4, column: 2 })
    expect(pos(8, 6)).toMatchObject({ line: 6, column: 6 })
  })

  it('maps anchored lines between two separate insertions', () => {
    const original = ['const a = 1', 'const b = 2', 'const c = 3'].join('\n')
    const transformed = [
      'const inserted1 = 0',
      'const a = 1',
      'const b = 2',
      'const inserted2 = 0',
      'const c = 3',
    ].join('\n')

    const pos = trace(original, transformed)

    expect(pos(2, 6)).toMatchObject({ line: 1, column: 6 })
    expect(pos(3, 6)).toMatchObject({ line: 2, column: 6 })
    expect(pos(5, 6)).toMatchObject({ line: 3, column: 6 })
  })

  it('handles multiple rewritten import lines', () => {
    const original = [
      "import { db } from 'src/lib/db'",
      "import { logger } from 'src/lib/logger'",
      'db.user.findFirst()',
    ].join('\n')
    const transformed = [
      "import { db } from '../lib/db.js'",
      "import { logger } from '../lib/logger.js'",
      'db.user.findFirst()',
    ].join('\n')

    const pos = trace(original, transformed)

    expect(pos(1, 0)).toMatchObject({ line: 1, column: 0 })
    expect(pos(2, 0)).toMatchObject({ line: 2, column: 0 })
    expect(pos(3, 8)).toMatchObject({ line: 3, column: 8 })
  })
})
