import { describe, expect, it } from 'vitest'

import { applySrcAlias } from '../src-alias.js'

describe('applySrcAlias', () => {
  it('rewrites a static import', () => {
    const code = `import { db } from 'src/lib/db'`

    expect(applySrcAlias(code, 'functions')).toBe(
      `import { db } from '../lib/db'`,
    )
  })

  it('rewrites a re-export', () => {
    const code = `export * from "src/lib/db"`

    expect(applySrcAlias(code, 'functions')).toBe(`export * from '../lib/db'`)
  })

  it('rewrites a dynamic import', () => {
    const code = `const { db } = await import('src/lib/db')`

    expect(applySrcAlias(code, 'functions')).toBe(
      `const { db } = await import('../lib/db')`,
    )
  })

  it('rewrites a dynamic import with double quotes and spaces', () => {
    const code = `const mod = await import( "src/lib/db.js" )`

    expect(applySrcAlias(code, 'services/users')).toBe(
      `const mod = await import("../../lib/db.js")`,
    )
  })

  it('rewrites a side-effect import', () => {
    const code = `import 'src/lib/setup'\nimport { db } from 'src/lib/db'`

    expect(applySrcAlias(code, 'functions')).toBe(
      `import '../lib/setup'\nimport { db } from '../lib/db'`,
    )
  })

  it('rewrites a require() call', () => {
    const code = `const { db } = require('src/lib/db')`

    expect(applySrcAlias(code, 'functions')).toBe(
      `const { db } = require('../lib/db')`,
    )
  })

  it('rewrites an import from the api/src root', () => {
    const code = `const { db } = await import('src/lib/db')`

    expect(applySrcAlias(code, '')).toBe(
      `const { db } = await import('./lib/db')`,
    )
  })

  it('leaves relative and package imports alone', () => {
    const code = [
      `import { db } from '../lib/db'`,
      `import { logger } from 'srcmap-logger'`,
      `const mod = await import('./local')`,
      `const pkg = require('src-package')`,
    ].join('\n')

    expect(applySrcAlias(code, 'functions')).toBe(code)
  })

  it('leaves import-statement text inside a string alone', () => {
    const code = `const snippet = "use import 'src/lib/setup' in your app"`

    expect(applySrcAlias(code, 'functions')).toBe(code)
  })
})
