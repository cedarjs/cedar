import { describe, it } from 'vitest'

describe('Middleware codemod', (context) => {
  if (process.env.CI && process.platform === 'win32') {
    // See my comments in this thread:
    // https://github.com/vitest-dev/vitest/discussions/6511
    context.skip('Skipping CI tests on Windows')
  }

  it('Handles the default TSX case', async () => {
    await matchTransformSnapshot('codemodMiddleware', 'defaultTsx')
  })

  it('Handles when OgImageMiddleware is already imported', async () => {
    await matchTransformSnapshot('codemodMiddleware', 'alreadyContainsImport')
  })

  it('Handles when registerMiddleware function is already defined', async () => {
    await matchTransformSnapshot(
      'codemodMiddleware',
      'registerFunctionAlreadyDefined',
    )
  })
})
