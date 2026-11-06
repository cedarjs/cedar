import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getOxcTransformReactVersion } from '../setupReactCompilerHandler.js'

describe('getOxcTransformReactVersion', () => {
  let webBase: string

  beforeEach(() => {
    webBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-react-compiler-'))
    fs.writeFileSync(path.join(webBase, 'package.json'), '{}')
  })

  afterEach(() => {
    fs.rmSync(webBase, { recursive: true, force: true })
  })

  function writeCedarVitePackageJson(packageJson: Record<string, unknown>) {
    const dir = path.join(webBase, 'node_modules', '@cedarjs', 'vite')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@cedarjs/vite', ...packageJson }),
    )
  }

  it("returns @cedarjs/vite's oxc-transform-react peer version", () => {
    writeCedarVitePackageJson({
      peerDependencies: { 'oxc-transform-react': '0.157.0', react: '19.3.1' },
    })

    expect(getOxcTransformReactVersion(webBase)).toBe('0.157.0')
  })

  it("throws when @cedarjs/vite doesn't declare the peer dependency", () => {
    writeCedarVitePackageJson({ peerDependencies: { react: '19.3.1' } })

    expect(() => getOxcTransformReactVersion(webBase)).toThrow(
      "Your version of @cedarjs/vite doesn't support the React Compiler",
    )
  })
})
