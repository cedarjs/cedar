import { beforeAll, describe, it } from 'vitest'

describe('Middleware codemod', () => {
  beforeAll(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    //   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

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
