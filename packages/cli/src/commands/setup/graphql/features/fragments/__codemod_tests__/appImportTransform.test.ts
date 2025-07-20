import { describe, test } from 'vitest'

// Skipping CI tests on Windows
// See my comments in this thread:
// https://github.com/vitest-dev/vitest/discussions/6511
describe.skipIf(process.env.CI && process.platform === 'win32')(
  'fragments possibleTypes import',
  () => {
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
  },
)
