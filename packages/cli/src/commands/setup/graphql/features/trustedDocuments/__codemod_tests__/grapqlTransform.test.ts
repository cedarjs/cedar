import { describe, test } from 'vitest'

// Skipping CI tests on Windows
// See my comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'trusted-documents graphql handler transform',
  () => {
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
  },
)
