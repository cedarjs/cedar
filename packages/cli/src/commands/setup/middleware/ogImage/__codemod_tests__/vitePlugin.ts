import { describe, it } from 'vitest'

// Skipping CI tests on Windows.
// See my comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'Vite plugin codemod',
  () => {
    it('Handles the default vite config case', async () => {
      await matchTransformSnapshot('codemodVitePlugin', 'defaultViteConfig')
    })
  },
)
