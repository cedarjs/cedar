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
  JSON.parse(
    fs.readFileSync(path.join(...segments, 'package.json'), 'utf8'),
  ).version

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

  it('fails when two versions would need the same place', () => {
    // api/node_modules has p@2, the root p@1, and a hoisted package needs
    // the root's: both would be at the top of the copy
    writePackage(path.join(app, 'api', 'node_modules', 'p'), 'p', '2.0.0')
    writePackage(path.join(app, 'node_modules', 'p'), 'p', '1.0.0')
    writePackage(path.join(app, 'node_modules', 'r'), 'r', '1.0.0', {
      p: '1',
    })

    expect(() =>
      vendorSandboxChildPackages(
        path.join(app, 'api', 'dist', 'ud', 'sandbox-children'),
        [
          {
            source: path.join(app, 'api', 'src', 'lib', 'a.child.ts'),
            imports: ['p', 'r'],
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
