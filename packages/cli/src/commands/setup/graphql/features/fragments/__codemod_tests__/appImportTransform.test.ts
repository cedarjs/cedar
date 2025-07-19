import { describe, test } from 'vitest'

describe('fragments possibleTypes import', (context) => {
  if (process.env.CI && process.platform === 'win32') {
    // See my comments in this thread:
    // https://github.com/vitest-dev/vitest/discussions/6511
    context.skip('Skipping CI tests on Windows')
  }

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
