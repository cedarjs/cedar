import { fs as memfs, vol } from 'memfs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getEslintSetupError } from '../lintPreflight.js'

vi.mock('node:fs', () => ({ ...memfs, default: { ...memfs } }))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({ base: 'project' }),
}))

vi.mock('@cedarjs/cli-helpers/packageManager/display', () => ({
  formatAddRootPackagesCommand: (packages: string[], dev: boolean) =>
    `yarn add${dev ? ' -D' : ''} ${packages.join(' ')}`,
}))

const FLAT_CONFIG = `
  import cedarConfig from '@cedarjs/eslint-config'

  export default await cedarConfig()
`

beforeEach(() => {
  vol.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getEslintSetupError', () => {
  describe('when the project has a flat config', () => {
    it('returns no error when @cedarjs/eslint-config is a devDependency', async () => {
      vol.fromJSON({
        'project/eslint.config.mjs': FLAT_CONFIG,
        'project/package.json': JSON.stringify({
          devDependencies: { '@cedarjs/eslint-config': '6.0.0' },
        }),
      })

      await expect(getEslintSetupError()).resolves.toBeUndefined()
    })

    it('returns no error when @cedarjs/eslint-config is a regular dependency', async () => {
      vol.fromJSON({
        'project/eslint.config.js': FLAT_CONFIG,
        'project/package.json': JSON.stringify({
          dependencies: { '@cedarjs/eslint-config': '6.0.0' },
        }),
      })

      await expect(getEslintSetupError()).resolves.toBeUndefined()
    })

    it('returns no error for a config that does not use @cedarjs/eslint-config', async () => {
      vol.fromJSON({
        'project/eslint.config.mjs': 'export default []',
        'project/package.json': JSON.stringify({
          devDependencies: { eslint: '8.57.1' },
        }),
      })

      await expect(getEslintSetupError()).resolves.toBeUndefined()
    })

    it('errors when the config uses @cedarjs/eslint-config but it is not installed', async () => {
      vol.fromJSON({
        'project/eslint.config.mjs': FLAT_CONFIG,
        'project/package.json': JSON.stringify({
          devDependencies: { '@cedarjs/core': '6.0.0' },
        }),
      })

      const error = await getEslintSetupError()

      expect(error).toContain('Cannot find `@cedarjs/eslint-config`')
      expect(error).toContain('eslint.config.mjs')
      expect(error).toContain('yarn add -D @cedarjs/eslint-config')
      expect(error).toContain('`@cedarjs/core` no longer depends on it')
    })
  })

  describe('when the project has no flat config', () => {
    it('returns no error when there is no legacy config either', async () => {
      vol.fromJSON({
        'project/package.json': JSON.stringify({ devDependencies: {} }),
      })

      await expect(getEslintSetupError()).resolves.toBeUndefined()
    })

    it('errors on a legacy .eslintrc.js file', async () => {
      vol.fromJSON({
        'project/.eslintrc.js':
          "module.exports = { extends: '@cedarjs/eslint-config' }",
        'project/package.json': JSON.stringify({
          devDependencies: { '@cedarjs/eslint-config': '6.0.0' },
        }),
      })

      const error = await getEslintSetupError()

      expect(error).toContain(
        "no longer supports ESLint's legacy config format",
      )
      expect(error).toContain('eslint.config.mjs')
      expect(error).toContain('export default await cedarConfig()')
    })

    it('errors on a legacy eslintConfig field in package.json', async () => {
      vol.fromJSON({
        'project/package.json': JSON.stringify({
          devDependencies: { '@cedarjs/eslint-config': '6.0.0' },
          eslintConfig: { extends: '@cedarjs/eslint-config' },
        }),
      })

      const error = await getEslintSetupError()

      expect(error).toContain(
        "no longer supports ESLint's legacy config format",
      )
    })

    it('also tells you to install the config package when it is missing', async () => {
      vol.fromJSON({
        'project/package.json': JSON.stringify({
          devDependencies: { '@cedarjs/core': '6.0.0' },
          eslintConfig: { extends: '@cedarjs/eslint-config' },
        }),
      })

      const error = await getEslintSetupError()

      expect(error).toContain(
        "no longer supports ESLint's legacy config format",
      )
      expect(error).toContain('yarn add -D @cedarjs/eslint-config')
    })

    it('does not tell you to install the config package when it is already there', async () => {
      vol.fromJSON({
        'project/.eslintrc.json': '{}',
        'project/package.json': JSON.stringify({
          devDependencies: { '@cedarjs/eslint-config': '6.0.0' },
        }),
      })

      const error = await getEslintSetupError()

      expect(error).not.toContain('yarn add -D @cedarjs/eslint-config')
    })
  })
})
