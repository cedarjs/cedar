import { describe, test } from 'vitest'

describe('trusted-documents graphql handler transform', (context) => {
  if (process.env.CI && process.platform === 'win32') {
    // See my comments in this thread:
    // https://github.com/vitest-dev/vitest/discussions/6511
    context.skip('Skipping CI tests on Windows')
  }

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
