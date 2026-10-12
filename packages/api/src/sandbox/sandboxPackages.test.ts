import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findChildScript } from './findChildScript.js'
import { runSandboxedChild } from './runSandboxedChild.js'
import { sandboxPackagePaths } from './sandboxPackages.js'

let tmp: string

beforeAll(() => {
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-sandbox-packages-')),
  )
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const writePackage = (
  dir: string,
  pkg: { name: string } & Record<string, unknown>,
) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
}

const link = (target: string, at: string) => {
  fs.mkdirSync(path.dirname(at), { recursive: true })
  fs.symlinkSync(target, at, 'junction')
}

/** A child script's path in a new app, and the app's node_modules */
const newApp = (name: string) => {
  const app = path.join(tmp, name)
  const script = path.join(app, 'api', 'src', 'lib', 'x.child.ts')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  return { script, nm: path.join(app, 'node_modules') }
}

describe('sandboxPackagePaths', () => {
  it("finds packages whatever their exports allow, and only what's needed", () => {
    const { script, nm } = newApp('exports')
    // Doesn't export its package.json, and has only an import condition
    writePackage(path.join(nm, 'esm-only'), {
      name: 'esm-only',
      exports: { '.': { import: './index.mjs' } },
      dependencies: { helper: '1' },
    })
    writePackage(path.join(nm, 'helper'), { name: 'helper' })
    writePackage(path.join(nm, 'unrelated'), { name: 'unrelated' })

    expect(sandboxPackagePaths(['esm-only'], script)).toEqual([
      path.join(nm, 'esm-only'),
      path.join(nm, 'helper'),
    ])
  })

  it('gives each package the nested version it uses', () => {
    const { script, nm } = newApp('nested')
    writePackage(path.join(nm, 'p'), { name: 'p', version: '1.0.0' })
    writePackage(path.join(nm, 'q'), { name: 'q', dependencies: { p: '2' } })
    writePackage(path.join(nm, 'q', 'node_modules', 'p'), {
      name: 'p',
      version: '2.0.0',
    })

    expect(sandboxPackagePaths(['q'], script)).toEqual([
      path.join(nm, 'q'),
      path.join(nm, 'q', 'node_modules', 'p'),
    ])
    expect(sandboxPackagePaths(['p', 'q'], script)).toContain(
      path.join(nm, 'p'),
    )
  })

  it("follows pnpm's layout, at the linked and the real paths", () => {
    const { script, nm } = newApp('pnpm')
    const inStore = (id: string, name: string) =>
      path.join(nm, '.pnpm', id, 'node_modules', name)
    writePackage(inStore('q@1', 'q'), { name: 'q', dependencies: { p: '2' } })
    writePackage(inStore('p@2', 'p'), { name: 'p' })
    link(inStore('p@2', 'p'), inStore('q@1', 'p'))
    link(inStore('q@1', 'q'), path.join(nm, 'q'))

    expect(sandboxPackagePaths(['q'], script)).toEqual([
      path.join(nm, 'q'),
      inStore('q@1', 'q'),
      inStore('q@1', 'p'),
      inStore('p@2', 'p'),
    ])
  })

  it('skips optional dependencies that are not installed, and survives a cycle', () => {
    const { script, nm } = newApp('optional')
    writePackage(path.join(nm, 'native'), {
      name: 'native',
      dependencies: { cyclic: '1' },
      optionalDependencies: {
        'native-this-platform': '1',
        'native-other-platform': '1',
      },
      peerDependencies: { 'not-installed-peer': '1' },
    })
    writePackage(path.join(nm, 'native-this-platform'), {
      name: 'native-this-platform',
    })
    writePackage(path.join(nm, 'cyclic'), {
      name: 'cyclic',
      dependencies: { native: '1' },
    })

    expect(sandboxPackagePaths(['native'], script)).toEqual([
      path.join(nm, 'native'),
      path.join(nm, 'cyclic'),
      path.join(nm, 'native-this-platform'),
    ])
  })

  it("throws for a package or a regular dependency that isn't installed", () => {
    const { script, nm } = newApp('missing')
    writePackage(path.join(nm, 'lonely'), {
      name: 'lonely',
      dependencies: { gone: '1' },
    })

    expect(() => sandboxPackagePaths(['nope'], script)).toThrow(
      `Can't find package "nope" (needed by x.child.ts)`,
    )
    expect(() => sandboxPackagePaths(['lonely'], script)).toThrow(
      `Can't find package "gone" (needed by lonely)`,
    )
  })
})

/** The monorepo's own node_modules, where sharp is installed */
const repoNodeModules = () => {
  let dir = import.meta.dirname
  while (!fs.existsSync(path.join(dir, 'node_modules', 'sharp'))) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('sharp is not installed')
    }
    dir = parent
  }
  return fs.realpathSync(path.join(dir, 'node_modules'))
}

// A real native library in the child, in an app laid out like a Cedar app:
// node_modules links sharp (installed elsewhere, like a symlinked store),
// the web side and a workspace package. These fail when sharp changes how
// it's packaged or Node changes its permission model, before an app using
// the sandbox finds out in production.
describe('sharp in a sandboxed child', () => {
  let app: string
  let lib: string

  beforeAll(() => {
    app = path.join(tmp, 'sharp-app')
    lib = path.join(app, 'api', 'src', 'lib')
    fs.mkdirSync(lib, { recursive: true })
    const nm = path.join(app, 'node_modules')
    link(path.join(repoNodeModules(), 'sharp'), path.join(nm, 'sharp'))
    fs.mkdirSync(path.join(app, 'web', 'src'), { recursive: true })
    link(path.join(app, 'web'), path.join(nm, 'web'))
    writePackage(path.join(app, 'packages', 'shared'), { name: '@app/shared' })
    link(path.join(app, 'packages', 'shared'), path.join(nm, '@app', 'shared'))

    fs.writeFileSync(path.join(app, '.env'), 'DATABASE_URL=postgres://secret')
    fs.writeFileSync(path.join(app, 'web', '.env'), 'WEB_SECRET=1')
    fs.writeFileSync(path.join(app, 'web', 'src', 'App.tsx'), 'web source')
    fs.writeFileSync(
      path.join(app, 'packages', 'shared', 'index.js'),
      'shared source',
    )

    // The documented form: a .ts child next to its caller, with a bare
    // import, run by Node stripping its types
    fs.writeFileSync(
      path.join(lib, 'thumbnail.child.ts'),
      `import sharp from 'sharp'

       const chunks: Buffer[] = []
       for await (const chunk of process.stdin) {
         chunks.push(chunk)
       }
       const size: number = Number(process.argv[2])
       process.stdout.write(
         await sharp(Buffer.concat(chunks)).resize(size, size).webp().toBuffer(),
       )`,
    )

    const reads = {
      appEnv: path.join(app, '.env'),
      webEnvThroughLink: path.join(nm, 'web', '.env'),
      webSource: path.join(app, 'web', 'src', 'App.tsx'),
      workspacePackage: path.join(app, 'packages', 'shared', 'index.js'),
      workspacePackageThroughLink: path.join(nm, '@app', 'shared', 'index.js'),
    }
    fs.writeFileSync(
      path.join(lib, 'reads.child.mjs'),
      `import fs from 'node:fs'
       const got = {}
       for (const [name, file] of Object.entries(${JSON.stringify(reads)})) {
         try {
           got[name] = fs.readFileSync(file, 'utf8')
         } catch (e) {
           got[name] = e.code
         }
       }
       process.stdout.write(JSON.stringify(got))`,
    )
  })

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

  it('resizes an image in a .ts child with a bare import', async () => {
    const result = await runSandboxedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      packages: ['sharp'],
      allowAddons: true,
      input: await png(),
      args: ['4'],
      timeoutMs: 20_000,
    })

    expect(result.ok ? '' : result.stderr).toBe('')
    const output = result.ok ? result.output : Buffer.alloc(0)
    const { width, format } = await sharp(output).metadata()
    expect([format, width]).toEqual(['webp', 4])
  })

  it("can't read .env, nor the other workspaces, directly or through node_modules", async () => {
    const result = await runSandboxedChild({
      script: path.join(lib, 'reads.child.mjs'),
      packages: ['sharp'],
      input: Buffer.alloc(0),
    })

    expect(result.ok ? JSON.parse(result.output.toString()) : result).toEqual({
      appEnv: 'ERR_ACCESS_DENIED',
      webEnvThroughLink: 'ERR_ACCESS_DENIED',
      webSource: 'ERR_ACCESS_DENIED',
      workspacePackage: 'ERR_ACCESS_DENIED',
      workspacePackageThroughLink: 'ERR_ACCESS_DENIED',
    })
  })

  it('cannot load sharp without allowAddons', async () => {
    const result = await runSandboxedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      packages: ['sharp'],
      input: await png(),
      args: ['4'],
      timeoutMs: 20_000,
    })

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain('ERR_DLOPEN_DISABLED')
  })

  it('cannot load sharp unless it is one of the packages', async () => {
    const result = await runSandboxedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      allowAddons: true,
      input: await png(),
      args: ['4'],
      timeoutMs: 20_000,
    })

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
  })

  it("is a spawn-error when a package isn't installed", async () => {
    const result = await runSandboxedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      packages: ['not-installed-anywhere'],
      input: Buffer.alloc(0),
    })

    expect(result).toMatchObject({ ok: false, failure: 'spawn-error' })
    expect(!result.ok && result.message).toContain('not-installed-anywhere')
  })
})
