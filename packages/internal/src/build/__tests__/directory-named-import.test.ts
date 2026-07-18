import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyDirectoryNamedImport } from '../directory-named-import.js'

const FIXTURE_FILE = path.join(
  __dirname,
  '__fixtures__/directory-named-imports/importer.ts',
)

describe('applyDirectoryNamedImport', () => {
  it('rewrites a directory-named import to its directory-named module (.js)', () => {
    const code = `import { ImpModule } from './Module'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `import { ImpModule } from './Module/Module'`,
    )
  })

  it('rewrites a directory-named import to its directory-named module (.tsx)', () => {
    const code = `import { ImpTSX } from './TSX'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `import { ImpTSX } from './TSX/TSX'`,
    )
  })

  it('rewrites a directory-named export', () => {
    const code = `export { ExpModule } from './Module'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `export { ExpModule } from './Module/Module'`,
    )
  })

  it('prefers index.* over the directory-named module', () => {
    const code = `export { ExpIndex } from './indexModule'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `export { ExpIndex } from './indexModule/index'`,
    )
  })

  it('supports .ts modules', () => {
    const code = `export { pew } from './TS'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `export { pew } from './TS/TS'`,
    )
  })

  it('supports .jsx modules', () => {
    const code = `export { pew } from './JSX'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `export { pew } from './JSX/JSX'`,
    )
  })

  it('leaves imports that already resolve directly to a file alone', () => {
    const code = `import { direct } from './DirectFile'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(code)
  })

  it('leaves imports that cannot be resolved at all alone', () => {
    const code = `import { nope } from './DoesNotExist'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(code)
  })

  it('leaves bare package imports alone', () => {
    const code = `import React from 'react'`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(code)
  })

  it('handles double-quoted imports', () => {
    const code = `import { ImpModule } from "./Module"`
    expect(applyDirectoryNamedImport(code, FIXTURE_FILE)).toBe(
      `import { ImpModule } from "./Module/Module"`,
    )
  })
})
