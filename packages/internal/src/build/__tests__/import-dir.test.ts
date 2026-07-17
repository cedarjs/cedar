import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyImportDir } from '../import-dir.js'

describe('applyImportDir', () => {
  it('returns null for code with no glob imports', () => {
    const code = `
import React from 'react'
import { someFunction } from './utils'

export default function Component() {}
`
    expect(applyImportDir(code, '/project/api/src/file.ts')).toBeNull()
  })

  it('returns null for code that includes ** but is not an import statement', () => {
    const code = `
// some comment with ** glob notation
const pattern = '**/*.ts'
`
    expect(applyImportDir(code, '/project/api/src/file.ts')).toBeNull()
  })

  it('expands a glob import when no files match (produces empty object)', () => {
    // Use a path that won't match any real files
    const code = `import services from './nonexistent-dir/**/*.{js,ts}'`
    const result = applyImportDir(code, path.join(__dirname, 'fake-file.ts'))
    // With no matching files the result is just the empty object declaration
    expect(result).not.toBeNull()
    expect(result!.code).toBe('let services = {};')
  })

  it('replaces the import statement with a let declaration', () => {
    const code = `import stuff from './nowhere/**/*.ts'`
    const result = applyImportDir(code, '/project/api/src/file.ts')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('let stuff = {};')
    expect(result!.code).not.toContain("import stuff from './nowhere/**/*.ts'")
  })

  it('handles double-quoted glob imports', () => {
    const code = `import stuff from "./nowhere/**/*.ts"`
    const result = applyImportDir(code, '/project/api/src/file.ts')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('let stuff = {};')
  })

  it('handles glob import with trailing semicolon', () => {
    const code = `import stuff from './nowhere/**/*.ts';`
    const result = applyImportDir(code, '/project/api/src/file.ts')
    expect(result).not.toBeNull()
    expect(result!.code).toContain('let stuff = {};')
  })

  it('returns null when there are no glob imports even if ** appears elsewhere', () => {
    const code = `
// ** is not a glob import here
const foo = require('./**')
import bar from './normal'
`
    expect(applyImportDir(code, '/project/api/src/file.ts')).toBeNull()
  })
})
