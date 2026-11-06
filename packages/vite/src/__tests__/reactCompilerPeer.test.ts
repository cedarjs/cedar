import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { satisfies } from 'verkit'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function readPackageJson(packageJsonPath: string) {
  const packageJson: {
    peerDependencies?: Record<string, string>
  } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

  return packageJson
}

describe('oxc-transform-react peer dependency', () => {
  it("is a version @vitejs/plugin-react's React Compiler supports", () => {
    // `yarn cedar experimental setup-react-compiler` installs exactly this
    // version, and @vitejs/plugin-react is what loads it
    const cedarVite = readPackageJson(
      path.join(import.meta.dirname, '..', '..', 'package.json'),
    )
    // @vitejs/plugin-react doesn't export its package.json
    const pluginReact = readPackageJson(
      path.join(
        path.dirname(require.resolve('@vitejs/plugin-react')),
        '..',
        'package.json',
      ),
    )

    const version = cedarVite.peerDependencies?.['oxc-transform-react']
    const supportedRange = pluginReact.peerDependencies?.['oxc-transform-react']

    expect(version).toBeDefined()
    expect(supportedRange).toBeDefined()
    expect(satisfies(version ?? '', supportedRange ?? '')).toBe(true)
  })
})
