import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll } from 'vitest'

import {
  findChildScript,
  runSandboxedChild,
  sandboxedChildArgs,
} from '@cedarjs/api/sandbox'

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
    // A full UD build takes a couple of seconds locally, but Windows CI
    // runners are slow enough, especially with other test files building in
    // parallel, that 30s wasn't enough headroom
  }, 90_000)

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

  it('produces handler chunks in api/dist/ud/chunks/', () => {
    const chunksDir = join(fixtureDir, 'api', 'dist', 'ud', 'chunks')
    expect(existsSync(chunksDir)).toBe(true)
    const entries = readdirSync(chunksDir)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((f) => f.endsWith('.js') || f.endsWith('.mjs'))).toBe(
      true,
    )
  })

  it('produces web/dist/index.html', () => {
    const htmlFile = join(fixtureDir, 'web', 'dist', 'index.html')
    expect(existsSync(htmlFile)).toBe(true)
    const content = readFileSync(htmlFile, 'utf-8')
    expect(content).toContain('id="cedar-app"')
  })

  describe('sandboxed child scripts', () => {
    const udDir = join(fixtureDir, 'api', 'dist', 'ud')
    const childrenDir = join(udDir, 'sandbox-children')

    it('emits each child as its own file, importing only packages', () => {
      const child = join(childrenDir, 'humanize.child.js')
      expect(existsSync(child)).toBe(true)
      const code = readFileSync(child, 'utf-8')
      expect(code).toMatch(/from ["']humanize-string["']/)
      expect(code).not.toMatch(/from ["']\.{1,2}\//)
    })

    it('copies the packages a child imports, and their dependencies', () => {
      const nodeModules = join(childrenDir, 'node_modules')
      expect(readdirSync(nodeModules).sort()).toEqual([
        'humanize-string',
        // decamelize's dependency, hoisted in the monorepo
        'xregexp',
      ])
      // Nested in humanize-string's own node_modules, as it's installed
      expect(
        existsSync(
          join(nodeModules, 'humanize-string/node_modules/decamelize'),
        ),
      ).toBe(true)
    })

    it('lets findChildScript find the child from code in the bundle', () => {
      const expected = join(childrenDir, 'humanize.child.js')
      expect(findChildScript(udDir, 'humanize.child')).toBe(expected)
      expect(findChildScript(join(udDir, 'chunks'), 'humanize.child')).toBe(
        expected,
      )
    })

    it("resolves the child's packages from the copies next to it", () => {
      const script = findChildScript(join(udDir, 'chunks'), 'humanize.child')
      const reads = sandboxedChildArgs({
        script,
        packages: ['humanize-string'],
      })
        .filter((arg) => arg.startsWith('--allow-fs-read='))
        .map((arg) => arg.slice('--allow-fs-read='.length))
        .slice(1)

      const nodeModules = join(childrenDir, 'node_modules')
      expect(reads).toEqual([
        join(nodeModules, 'humanize-string'),
        join(nodeModules, 'humanize-string/node_modules/decamelize'),
        join(nodeModules, 'xregexp'),
        // decamelize's lookup of xregexp checks humanize-string's
        // node_modules on the way
        join(nodeModules, 'humanize-string/node_modules/xregexp/package.json'),
      ])
    })

    it('runs the bundled child in the sandbox', async () => {
      const result = await runSandboxedChild({
        script: findChildScript(join(udDir, 'chunks'), 'humanize.child'),
        packages: ['humanize-string'],
        input: Buffer.from('sandboxed_childScript'),
      })

      expect(result.ok ? result.output.toString() : result.stderr).toBe(
        'Sandboxed child script',
      )
    })

    it('runs the child of the regular build, next to its caller', async () => {
      const libDir = join(fixtureDir, 'api', 'dist', 'lib')
      const script = findChildScript(libDir, 'humanize.child')
      expect(script).toBe(join(libDir, 'humanize.child.js'))

      const result = await runSandboxedChild({
        script,
        packages: ['humanize-string'],
        input: Buffer.from('sandboxed_childScript'),
      })

      expect(result.ok ? result.output.toString() : result.stderr).toBe(
        'Sandboxed child script',
      )
    })
  })
})
