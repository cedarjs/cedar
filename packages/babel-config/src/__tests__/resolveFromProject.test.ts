import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getMissingApiBabelPackageMessage,
  getUnsupportedApiBabelVersionMessage,
  loadBabelCoreFromProject,
  resolveFromProject,
} from '../resolveFromProject.js'

const FIXTURE_PATH = path.join(__dirname, '__fixtures__/cedar-app')

afterEach(() => {
  delete process.env.CEDAR_CWD
})

describe('resolveFromProject', () => {
  it('resolves packages that are installed above the project', () => {
    // The fixture has no node_modules of its own, so Node's lookup walks up
    // into the monorepo's install, which does have @babel/core
    process.env.CEDAR_CWD = FIXTURE_PATH

    const resolved = resolveFromProject('@babel/core')

    expect(path.isAbsolute(resolved)).toBe(true)
    expect(resolved).toMatch(/[\\/]@babel[\\/]core[\\/]/)
    expect(typeof loadBabelCoreFromProject().transformAsync).toBe('function')
  })

  it('throws an actionable error when the package is not installed', () => {
    // A project outside of any node_modules tree, with nothing installed
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-app-'))
    fs.writeFileSync(path.join(projectPath, 'cedar.toml'), '')
    process.env.CEDAR_CWD = projectPath

    expect(() => resolveFromProject('@babel/core')).toThrow(
      getMissingApiBabelPackageMessage('@babel/core'),
    )
    expect(() => loadBabelCoreFromProject()).toThrow(
      getMissingApiBabelPackageMessage('@babel/core'),
    )
    expect(() => resolveFromProject('@babel/preset-typescript')).toThrow(
      getMissingApiBabelPackageMessage('@babel/preset-typescript'),
    )
  })

  it('tells the user which packages to install and how', () => {
    expect(
      getMissingApiBabelPackageMessage('@babel/core'),
    ).toMatchInlineSnapshot(
      `"api/babel.config.js was found, but @babel/core is not installed. Custom Babel configuration for the api side needs @babel/core and @babel/preset-typescript: run \`yarn workspace api add -D @babel/core@^7 @babel/preset-typescript@^7\`."`,
    )
    expect(
      getUnsupportedApiBabelVersionMessage('@babel/core', '8.0.1'),
    ).toMatchInlineSnapshot(
      `"api/babel.config.js was found, but the installed @babel/core (8.0.1) is not supported. Custom Babel configuration for the api side needs @babel/core and @babel/preset-typescript 7.x: run \`yarn workspace api add -D @babel/core@^7 @babel/preset-typescript@^7\`."`,
    )
  })
})
