import { describe, test } from 'vitest'

describe('fragments possibleTypes import', (context) => {
  if (process.env.CI && process.platform === 'win32') {
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
