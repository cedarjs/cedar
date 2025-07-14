import { beforeAll, describe, test } from 'vitest'

describe('trusted-documents graphql handler transform', () => {
  beforeAll(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    //   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

  test('Default handler', async () => {
    await matchFolderTransform('graphqlTransform', 'graphql', {
      useJsCodeshift: true,
    })
  })

  test('Handler with the store already set up', async () => {
    await matchFolderTransform('graphqlTransform', 'alreadySetUp', {
      useJsCodeshift: true,
    })
  })
})
