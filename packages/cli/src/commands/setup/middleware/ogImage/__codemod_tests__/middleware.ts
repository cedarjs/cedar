import { describe, it } from 'vitest'

// Skipping CI tests on Windows.
// See my comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'Middleware codemod',
  () => {
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
  },
)
