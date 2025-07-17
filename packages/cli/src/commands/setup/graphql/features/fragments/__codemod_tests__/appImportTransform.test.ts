import { afterEach, describe, test } from 'vitest'

describe('fragments possibleTypes import', () => {
  afterEach(async () => {
    // The fast implementation should eliminate the need for this workaround
    // but keeping minimal cleanup just in case
    await new Promise((res) => setImmediate(res))
  })

  test('Default App.tsx', async () => {
    await matchFolderTransformFast('appImportTransform', 'import-simple', {
      useJsCodeshift: true,
    })
  })

  test('App.tsx with existing import', async () => {
    await matchFolderTransformFast('appImportTransform', 'existingImport', {
      useJsCodeshift: true,
    })
  })
})
