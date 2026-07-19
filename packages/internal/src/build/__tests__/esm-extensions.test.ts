import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyEsmExtensions } from '../esm-extensions.js'

// Pretend the importer lives at api/src/functions/graphql.ts so that
// relative imports like `../lib/db` resolve to the fixture files.
const FIXTURE_SRC = path.join(__dirname, '__fixtures__/esm-extensions/src')
const IMPORTER = path.join(FIXTURE_SRC, 'functions/graphql.ts')

describe('applyEsmExtensions', () => {
  it('appends .js when a .ts source file exists', () => {
    const code = `import { db } from '../lib/db'`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `import { db } from '../lib/db.js'`,
    )
  })

  it('appends .jsx when a .jsx source file exists', () => {
    const code = `import { Server } from '../lib/server'`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `import { Server } from '../lib/server.jsx'`,
    )
  })

  it('handles double-quoted imports', () => {
    const code = `import { db } from "../lib/db"`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `import { db } from "../lib/db.js"`,
    )
  })

  it('handles re-exports', () => {
    const code = `export { db } from '../lib/db'`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `export { db } from '../lib/db.js'`,
    )
  })

  it('leaves imports that already have the correct .js extension alone', () => {
    const code = `import { x } from '../lib/already.js'`
    // already.js exists on disk, so the .js extension is already correct
    expect(applyEsmExtensions(code, IMPORTER)).toBe(code)
  })

  it('normalises a .js extension that points at a .ts source file', () => {
    // Caller wrote ./db.js but the source is db.ts — strip and re-add.
    const code = `import { db } from '../lib/db.js'`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `import { db } from '../lib/db.js'`,
    )
  })

  it('leaves imports where the base .js file exists (not .ts) alone', () => {
    const code = `import { x } from '../lib/already'`
    // already.js exists, so it should get .js appended
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `import { x } from '../lib/already.js'`,
    )
  })

  it('leaves imports where no matching file exists unchanged', () => {
    const code = `import { x } from '../lib/nonexistent'`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(code)
  })

  it('leaves bare package specifiers untouched', () => {
    const code = `import { foo } from 'some-package'`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(code)
  })

  it('leaves non-JS extensions (.json, .css, etc.) untouched', () => {
    const jsonImport = `import data from '../data.json'`
    const cssImport = `import styles from '../styles.css'`
    expect(applyEsmExtensions(jsonImport, IMPORTER)).toBe(jsonImport)
    expect(applyEsmExtensions(cssImport, IMPORTER)).toBe(cssImport)
  })

  it('handles dynamic imports', () => {
    const code = `const mod = await import('../lib/db')`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `const mod = await import('../lib/db.js')`,
    )
  })

  it('handles dynamic imports with double quotes', () => {
    const code = `const mod = await import("../lib/db")`
    expect(applyEsmExtensions(code, IMPORTER)).toBe(
      `const mod = await import("../lib/db.js")`,
    )
  })
})
