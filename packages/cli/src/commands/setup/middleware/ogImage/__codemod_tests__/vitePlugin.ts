import { describe, it } from 'vitest'

describe('Vite plugin codemod', (context) => {
  if (process.env.CI && process.platform === 'win32') {
    // See my comments in this thread:
    // https://github.com/vitest-dev/vitest/discussions/6511
    context.skip('Skipping CI tests on Windows')
  }

  it('Handles the default vite config case', async () => {
    await matchTransformSnapshot('codemodVitePlugin', 'defaultViteConfig')
  })
})
