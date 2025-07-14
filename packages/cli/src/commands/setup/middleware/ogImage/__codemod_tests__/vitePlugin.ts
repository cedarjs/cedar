import { beforeAll, describe, it } from 'vitest'

describe('Vite plugin codemod', () => {
  beforeAll(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    //   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

  beforeAll(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

  it('Handles the default vite config case', async () => {
    await matchTransformSnapshot('codemodVitePlugin', 'defaultViteConfig')
  })
})
