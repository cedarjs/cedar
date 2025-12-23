import { describe, it } from 'vitest'

import { matchFolderTransform } from '../../../../testUtils/matchFolderTransform'
import moveGeneratorTemplates from '../moveGeneratorTemplates'

describe('moveGeneratorTemplates', () => {
  it('Moves web/ and api/ generator templates to the new top-level /generatorTemplates directory', async () => {
    await matchFolderTransform(moveGeneratorTemplates, 'default')
  })
})
