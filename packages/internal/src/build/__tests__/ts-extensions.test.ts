import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applyTsExtensions, assertNoTsSpecifiers } from '../ts-extensions.js'

// Pretend the importer lives at api/src/functions/graphql.ts so that relative
// imports like `../lib/db.ts` resolve to the fixture files.
const FIXTURE_SRC = path.join(__dirname, '__fixtures__/ts-extensions/src')
const IMPORTER = path.join(FIXTURE_SRC, 'functions/graphql.ts')

describe('applyTsExtensions', () => {
  it('rewrites a .ts specifier to .js', () => {
    const code = `import { db } from '../lib/db.ts'`
    expect(applyTsExtensions(code, IMPORTER)).toBe(
      `import { db } from '../lib/db.js'`,
    )
  })

  it('rewrites .mts and .tsx specifiers to .js', () => {
    const code = [
      `import { legacy } from '../lib/legacy.mts'`,
      `import { Component } from '../lib/component.tsx'`,
    ].join('\n')

    expect(applyTsExtensions(code, IMPORTER)).toBe(
      [
        `import { legacy } from '../lib/legacy.js'`,
        `import { Component } from '../lib/component.js'`,
      ].join('\n'),
    )
  })

  it('handles double quotes, re-exports, dynamic imports and require', () => {
    const code = [
      `export { db } from "../lib/db.ts"`,
      `const { db } = await import('../lib/db.ts')`,
      `const { db } = require("../lib/db.ts")`,
    ].join('\n')

    expect(applyTsExtensions(code, IMPORTER)).toBe(
      [
        `export { db } from "../lib/db.js"`,
        `const { db } = await import('../lib/db.js')`,
        `const { db } = require("../lib/db.js")`,
      ].join('\n'),
    )
  })

  it('rewrites the specifiers a TypeScript Prisma client emits', () => {
    // `prisma-client` with `importFileExtension = "ts"` generates a client
    // whose files import each other by their `.ts` extension. When the client
    // is generated into `api/src` those files are part of the api build.
    const client = path.join(FIXTURE_SRC, 'lib/prisma/client.ts')
    const code = `const { PrismaClient } = require("./internal/class.ts")`

    expect(applyTsExtensions(code, client)).toBe(
      `const { PrismaClient } = require("./internal/class.js")`,
    )
  })

  it('leaves specifiers with no matching source file alone', () => {
    const code = `import data from '../lib/nonexistent.ts'`
    expect(applyTsExtensions(code, IMPORTER)).toBe(code)
  })

  it('leaves bare package specifiers alone', () => {
    const code = `import { PrismaClient } from 'api/db/generated/prisma/client.ts'`
    expect(applyTsExtensions(code, IMPORTER)).toBe(code)
  })

  it('leaves .js specifiers alone', () => {
    const code = `import plain from '../lib/plain.js'`
    expect(applyTsExtensions(code, IMPORTER)).toBe(code)
  })
})

describe('assertNoTsSpecifiers', () => {
  let distDir: string | undefined

  afterEach(() => {
    if (distDir) {
      fs.rmSync(distDir, { recursive: true, force: true })
      distDir = undefined
    }
  })

  const makeDist = (contents: string) => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-ts-extensions-'))
    fs.mkdirSync(path.join(distDir, 'lib'))
    fs.writeFileSync(path.join(distDir, 'lib/db.js'), contents)
    return distDir
  }

  it('resolves when no .ts specifier survived', async () => {
    await expect(
      assertNoTsSpecifiers(makeDist(`require("./client.js")`)),
    ).resolves.toBeUndefined()
  })

  it('throws and names the offending specifier', async () => {
    await expect(
      assertNoTsSpecifiers(makeDist(`require("./internal/class.ts")`)),
    ).rejects.toThrow('./internal/class.ts')
  })

  it('resolves when there is no build output to check', async () => {
    await expect(
      assertNoTsSpecifiers(path.join(os.tmpdir(), 'cedar-no-such-dist')),
    ).resolves.toBeUndefined()
  })
})
