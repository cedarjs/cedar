import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '__fixtures__',
  'cedar-ud-app',
)

describe('UD build against fixture', () => {
  beforeAll(async () => {
    process.env.CEDAR_CWD = fixtureDir
    const { buildCedarApp } = await import('../buildApp.js')
    await buildCedarApp({ ud: true, verbose: false })
  }, 30_000)

  it('produces api/dist/ud/index.js', () => {
    const outFile = join(fixtureDir, 'api', 'dist', 'ud', 'index.js')
    expect(existsSync(outFile)).toBe(true)
    const content = readFileSync(outFile, 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('produces api/dist/ud/package.json', () => {
    const pkg = join(fixtureDir, 'api', 'dist', 'ud', 'package.json')
    expect(existsSync(pkg)).toBe(true)
    expect(JSON.parse(readFileSync(pkg, 'utf-8'))).toEqual({ type: 'module' })
  })
})
