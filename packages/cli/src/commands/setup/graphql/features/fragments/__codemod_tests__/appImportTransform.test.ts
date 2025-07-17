import { afterEach, describe, test } from 'vitest'

describe('fragments possibleTypes import', () => {
  afterEach(async () => {
    // Was running into this issue
    // https://github.com/vitest-dev/vitest/discussions/6511
    //   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
    // One workaround that was posted there was this:
    // TODO: Remove this workaround once the issue is fixed
    await new Promise((res) => setImmediate(res))
  })

  test('Default App.tsx', async () => {
    await matchFolderTransform('appImportTransform', 'import-simple', {
      useJsCodeshift: true,
    })
  })

  test('App.tsx with existing import', async () => {
    await matchFolderTransform('appImportTransform', 'existingImport', {
      useJsCodeshift: true,
    })
  })
})
