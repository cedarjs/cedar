import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findChildScript } from './findChildScript.js'
import { nodeModulesReadPaths } from './nodeModulesReadPaths.js'
import { runSandboxedChild } from './runSandboxedChild.js'

let tmp: string

beforeAll(() => {
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-sandbox-paths-')),
  )
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
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

describe('nodeModulesReadPaths', () => {
  it('finds every node_modules from a folder up, and symlinked packages', () => {
    const root = path.join(tmp, 'monorepo')
    const app = path.join(root, 'app')
    const lib = path.join(app, 'api', 'src', 'lib')
    fs.mkdirSync(lib, { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules', '@scope'), { recursive: true })
    fs.mkdirSync(path.join(app, 'api', 'node_modules'), { recursive: true })
    // Not a node_modules folder: never readable
    fs.writeFileSync(path.join(app, '.env'), 'SECRET=1')

    // A workspace package, linked from node_modules
    const workspacePackage = path.join(root, 'packages', 'shared')
    fs.mkdirSync(workspacePackage, { recursive: true })
    fs.symlinkSync(
      workspacePackage,
      path.join(root, 'node_modules', '@scope', 'shared'),
      'junction',
    )
    // The workspace the child is in (the app's api side), which a
    // workspace manager links too: not readable
    fs.symlinkSync(
      path.join(app, 'api'),
      path.join(root, 'node_modules', 'api'),
      'junction',
    )
    // A pnpm-style link that stays inside node_modules: covered already
    const store = path.join(
      root,
      'node_modules',
      '.pnpm',
      'dep',
      'node_modules',
    )
    fs.mkdirSync(path.join(store, 'dep'), { recursive: true })
    fs.symlinkSync(
      path.join(store, 'dep'),
      path.join(root, 'node_modules', 'dep'),
      'junction',
    )

    const expected = [
      path.join(app, 'api', 'node_modules'),
      path.join(root, 'node_modules'),
      workspacePackage,
    ]
    const found = nodeModulesReadPaths(path.join(lib, 'resize.child.js'))
    // Any node_modules above the temporary folder are the machine's own
    expect(found.slice(0, 3)).toEqual(expected)
    expect(found).not.toContain(app)
    expect(found).not.toContain(path.join(app, 'api'))
    expect(nodeModulesReadPaths(pathToFileURL(lib)).slice(0, 3)).toEqual(
      expected,
    )
  })

  it('walks up from the real folder too, when `from` is under a symlink', () => {
    // releases/node_modules is above the real folder only
    const releases = path.join(tmp, 'releases')
    const v1 = path.join(releases, 'v1', 'api', 'dist', 'lib')
    fs.mkdirSync(v1, { recursive: true })
    fs.mkdirSync(path.join(releases, 'node_modules'))
    const current = path.join(tmp, 'deploy', 'current')
    fs.mkdirSync(path.dirname(current))
    fs.symlinkSync(path.join(releases, 'v1'), current, 'junction')

    expect(
      nodeModulesReadPaths(path.join(current, 'api', 'dist', 'lib')),
    ).toContain(path.join(releases, 'node_modules'))
  })
})

// A real native library in the child, in an app laid out like a Cedar app.
// These fail when sharp changes how it's packaged (where its binary and
// libvips live, what it loads to pick them) or when Node changes its
// permission model, before an app using the sandbox finds out in
// production.
describe('sharp in a sandboxed child', () => {
  let lib: string
  let env: string

  beforeAll(() => {
    // app/node_modules is the monorepo's, through a symlink, like a
    // deployment's shared node_modules
    const app = path.join(tmp, 'sharp-app')
    lib = path.join(app, 'api', 'dist', 'lib')
    fs.mkdirSync(lib, { recursive: true })
    fs.symlinkSync(
      repoNodeModules(),
      path.join(app, 'node_modules'),
      'junction',
    )
    env = path.join(app, '.env')
    fs.writeFileSync(env, 'DATABASE_URL=postgres://secret')

    fs.writeFileSync(
      path.join(lib, 'resize.child.mjs'),
      `import sharp from 'sharp'
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
    fs.writeFileSync(
      path.join(lib, 'env.child.mjs'),
      `import fs from 'node:fs'
       process.stdout.write(fs.readFileSync(${JSON.stringify(env)}))`,
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

  it('resizes an image, reading only node_modules', async () => {
    const result = await runSandboxedChild({
      script: path.join(lib, 'resize.child.mjs'),
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

  it('runs a .ts child with a bare import, found by findChildScript', async () => {
    const result = await runSandboxedChild({
      script: findChildScript(lib, 'thumbnail.child'),
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

  it('cannot read the .env next to node_modules', async () => {
    const result = await runSandboxedChild({
      script: path.join(lib, 'env.child.mjs'),
      allowAddons: true,
      input: Buffer.alloc(0),
    })

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain(
      "permission: 'FileSystemRead'",
    )
    expect(result.ok || result.stderr).not.toContain('postgres://secret')
  })

  it('cannot load sharp without allowAddons', async () => {
    const result = await runSandboxedChild({
      script: path.join(lib, 'resize.child.mjs'),
      input: await png(),
      timeoutMs: 20_000,
    })

    expect(result).toMatchObject({ ok: false, failure: 'exit' })
    expect(!result.ok && result.stderr).toContain('ERR_DLOPEN_DISABLED')
  })

  it('cannot load sharp without node_modules', async () => {
    const result = await runSandboxedChild({
      script: path.join(lib, 'resize.child.mjs'),
      nodeModulesFrom: false,
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
