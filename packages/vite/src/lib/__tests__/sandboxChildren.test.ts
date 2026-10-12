import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { vendorSandboxChildPackages } from '../sandboxChildren.js'

let app: string

const writePackage = (
  dir: string,
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version, dependencies }),
  )
}

const versionAt = (...segments: string[]) =>
  JSON.parse(fs.readFileSync(path.join(...segments, 'package.json'), 'utf8'))
    .version

beforeEach(() => {
  app = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-vendor-')))
  fs.mkdirSync(path.join(app, 'api', 'src', 'lib'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(app, { recursive: true, force: true })
})

describe('vendorSandboxChildPackages', () => {
  it('gives every package the versions it has in the app', () => {
    const nm = path.join(app, 'node_modules')
    // q needs p@2, nested in its own node_modules; the app has p@1
    writePackage(path.join(nm, 'p'), 'p', '1.0.0')
    writePackage(path.join(nm, 'q'), 'q', '1.0.0', { p: '2' })
    writePackage(path.join(nm, 'q', 'node_modules', 'p'), 'p', '2.0.0')
    // r is hoisted, and needs the app's p@1
    writePackage(path.join(nm, 'r'), 'r', '1.0.0', { p: '1' })

    const childrenDir = path.join(app, 'api', 'dist', 'ud', 'sandbox-children')
    const source = (name: string) =>
      path.join(app, 'api', 'src', 'lib', `${name}.child.ts`)
    vendorSandboxChildPackages(childrenDir, [
      { source: source('a'), imports: ['q', 'node:fs'] },
      { source: source('b'), imports: ['p', 'r/sub/path'] },
    ])

    const copied = path.join(childrenDir, 'node_modules')
    expect(versionAt(copied, 'p')).toBe('1.0.0')
    expect(versionAt(copied, 'q', 'node_modules', 'p')).toBe('2.0.0')
    expect(versionAt(copied, 'r')).toBe('1.0.0')
    expect(fs.existsSync(path.join(copied, 'r', 'node_modules'))).toBe(false)
  })

  it('keeps a hoisted package on the version it uses when the top has another', () => {
    // api/node_modules has p@2, which the child imports; the root has p@1,
    // which a hoisted package needs
    writePackage(path.join(app, 'api', 'node_modules', 'p'), 'p', '2.0.0')
    writePackage(path.join(app, 'node_modules', 'p'), 'p', '1.0.0')
    writePackage(path.join(app, 'node_modules', 'r'), 'r', '1.0.0', {
      p: '1',
    })

    const childrenDir = path.join(app, 'api', 'dist', 'ud', 'sandbox-children')
    vendorSandboxChildPackages(childrenDir, [
      {
        source: path.join(app, 'api', 'src', 'lib', 'a.child.ts'),
        imports: ['p', 'r'],
      },
    ])

    const copied = path.join(childrenDir, 'node_modules')
    expect(versionAt(copied, 'p')).toBe('2.0.0')
    expect(versionAt(copied, 'r', 'node_modules', 'p')).toBe('1.0.0')
  })

  it("keeps pnpm's layout: each package's dependencies beside it", () => {
    const store = path.join(app, 'node_modules', '.pnpm')
    const pkgIn = (id: string, name: string) =>
      path.join(store, id, 'node_modules', name)
    // q@1 -> p@2 and r@1 -> p@1, each linked beside its dependent
    writePackage(pkgIn('p@1', 'p'), 'p', '1.0.0')
    writePackage(pkgIn('p@2', 'p'), 'p', '2.0.0')
    writePackage(pkgIn('q@1', 'q'), 'q', '1.0.0', { p: '2', r: '1' })
    writePackage(pkgIn('r@1', 'r'), 'r', '1.0.0', { p: '1', q: '1' })
    const link = (target: string, at: string) => {
      fs.mkdirSync(path.dirname(at), { recursive: true })
      fs.symlinkSync(target, at, 'junction')
    }
    link(pkgIn('p@2', 'p'), pkgIn('q@1', 'p'))
    link(pkgIn('r@1', 'r'), pkgIn('q@1', 'r'))
    link(pkgIn('p@1', 'p'), pkgIn('r@1', 'p'))
    // A cycle back to q
    link(pkgIn('q@1', 'q'), pkgIn('r@1', 'q'))
    link(pkgIn('q@1', 'q'), path.join(app, 'node_modules', 'q'))

    const childrenDir = path.join(app, 'api', 'dist', 'ud', 'sandbox-children')
    vendorSandboxChildPackages(childrenDir, [
      {
        source: path.join(app, 'api', 'src', 'lib', 'a.child.ts'),
        imports: ['q'],
      },
    ])

    const q = path.join(childrenDir, 'node_modules', 'q')
    expect(versionAt(q)).toBe('1.0.0')
    expect(versionAt(q, 'node_modules', 'p')).toBe('2.0.0')
    expect(versionAt(q, 'node_modules', 'r', 'node_modules', 'p')).toBe(
      '1.0.0',
    )
  })

  it('fails when two versions would need the same place', () => {
    // Two children whose own imports of p resolve to different versions
    writePackage(path.join(app, 'api', 'node_modules', 'p'), 'p', '2.0.0')
    writePackage(path.join(app, 'node_modules', 'p'), 'p', '1.0.0')
    fs.mkdirSync(path.join(app, 'scripts'), { recursive: true })

    expect(() =>
      vendorSandboxChildPackages(
        path.join(app, 'api', 'dist', 'ud', 'sandbox-children'),
        [
          {
            source: path.join(app, 'api', 'src', 'lib', 'a.child.ts'),
            imports: ['p'],
          },
          {
            source: path.join(app, 'scripts', 'b.child.ts'),
            imports: ['p'],
          },
        ],
      ),
    ).toThrow(/need two versions of "p" in one place/)
  })

  it('fails for a package that is not installed', () => {
    expect(() =>
      vendorSandboxChildPackages(path.join(app, 'out'), [
        {
          source: path.join(app, 'api', 'src', 'lib', 'a.child.ts'),
          imports: ['missing'],
        },
      ]),
    ).toThrow(/Can't find package "missing", which a.child.ts imports/)
  })
})
