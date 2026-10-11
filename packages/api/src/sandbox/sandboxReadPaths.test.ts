import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runSandboxedChild } from './runSandboxedChild.js'
import { sandboxReadPaths } from './sandboxReadPaths.js'

let tmp: string

beforeAll(() => {
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-sandbox-paths-')),
  )
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const writePackage = (dir: string, pkg: Record<string, unknown>) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
}

describe('sandboxReadPaths', () => {
  it("finds a package's dependencies, nested and hoisted, and the installed optional ones", () => {
    const app = path.join(tmp, 'app')
    const nm = path.join(app, 'node_modules')
    writePackage(path.join(nm, 'parser'), {
      name: 'parser',
      // Doesn't export its package.json; found anyway
      exports: { '.': './index.js' },
      dependencies: { hoisted: '1', nested: '1' },
      optionalDependencies: {
        '@native/parser-this-platform': '1',
        '@native/parser-other-platform': '1',
      },
      peerDependencies: { 'not-installed-peer': '1' },
    })
    writePackage(path.join(nm, 'parser', 'node_modules', 'nested'), {
      name: 'nested',
    })
    writePackage(path.join(nm, 'hoisted'), {
      name: 'hoisted',
      dependencies: { parser: '1' },
    })
    writePackage(path.join(nm, '@native', 'parser-this-platform'), {
      name: '@native/parser-this-platform',
    })
    writePackage(path.join(nm, 'unrelated'), { name: 'unrelated' })

    const from = path.join(app, 'src', 'lib', 'parse.js')

    expect(sandboxReadPaths(['parser'], { from })).toEqual([
      path.join(nm, 'parser'),
      path.join(nm, 'hoisted'),
      path.join(nm, 'parser', 'node_modules', 'nested'),
      path.join(nm, '@native', 'parser-this-platform'),
    ])
    expect(sandboxReadPaths(['parser'], { from, dependencies: false })).toEqual(
      [path.join(nm, 'parser')],
    )
  })

  it('throws for a missing package or a missing regular dependency', () => {
    const app = path.join(tmp, 'broken')
    writePackage(path.join(app, 'node_modules', 'lonely'), {
      name: 'lonely',
      dependencies: { gone: '1' },
    })

    expect(() => sandboxReadPaths(['nope'], { from: app })).toThrow(
      'can\'t find package "nope"',
    )
    expect(() => sandboxReadPaths(['lonely'], { from: app })).toThrow(
      'can\'t find package "gone" (needed by lonely)',
    )
  })

  it('takes a file URL', () => {
    const [sharpDir] = sandboxReadPaths(['sharp'], { from: import.meta.url })

    const pkg: unknown = JSON.parse(
      fs.readFileSync(path.join(sharpDir, 'package.json'), 'utf8'),
    )
    expect(pkg).toMatchObject({ name: 'sharp' })
  })
})

// A real native library in the child. These fail when sharp changes how
// it's packaged (where its binary and libvips live, what it loads to pick
// them) or when Node changes its permission model, before an app using the
// sandbox finds out in production.
describe('sharp in a sandboxed child', () => {
  // sharp doesn't export its package.json, so it's found the way
  // sandboxReadPaths finds it
  const [sharpDir] = sandboxReadPaths(['sharp'], {
    from: import.meta.url,
    dependencies: false,
  })
  const sharpPackageJson = path.join(sharpDir, 'package.json')

  // The child's script lives in a temporary folder, outside node_modules;
  // it loads sharp through a require() rooted in sharp's own folder
  const childScript = () => {
    const script = path.join(tmp, 'resize.child.mjs')
    fs.writeFileSync(
      script,
      `import { createRequire } from 'node:module'
       const sharp = createRequire(${JSON.stringify(sharpPackageJson)})('sharp')
       const chunks = []
       for await (const chunk of process.stdin) chunks.push(chunk)
       sharp.block({ operation: ['VipsForeignLoad'] })
       sharp.unblock({ operation: ['VipsForeignLoadPngBuffer'] })
       const webp = await sharp(Buffer.concat(chunks), { failOn: 'error' })
         .resize(8, 8)
         .webp()
         .toBuffer()
       process.stdout.write(webp)`,
    )
    return script
  }

  const png = () =>
    sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

  it('resizes an image with only the paths sandboxReadPaths gives it', async () => {
    const result = await runSandboxedChild({
      script: childScript(),
      readable: sandboxReadPaths(['sharp'], { from: import.meta.url }),
      allowAddons: true,
      input: await png(),
      timeoutMs: 20_000,
    })

    expect(result.ok ? '' : result.stderr).toBe('')
    expect(result.ok).toBe(true)
    const output = result.ok ? result.output : Buffer.alloc(0)
    expect(output.toString('latin1', 8, 12)).toBe('WEBP')
    const { width, height } = await sharp(output).metadata()
    expect([width, height]).toEqual([8, 8])
  })

  it('cannot load sharp without allowAddons', async () => {
    const result = await runSandboxedChild({
      script: childScript(),
      readable: sandboxReadPaths(['sharp'], { from: import.meta.url }),
      input: await png(),
      timeoutMs: 20_000,
    })

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain('ERR_DLOPEN_DISABLED')
  })

  it('cannot load sharp with only its own folder readable', async () => {
    const result = await runSandboxedChild({
      script: childScript(),
      readable: sandboxReadPaths(['sharp'], {
        from: import.meta.url,
        dependencies: false,
      }),
      allowAddons: true,
      input: await png(),
      timeoutMs: 20_000,
    })

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain(
      "permission: 'FileSystemRead'",
    )
  })
})
