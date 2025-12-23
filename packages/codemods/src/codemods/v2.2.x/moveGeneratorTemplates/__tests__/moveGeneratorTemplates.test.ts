import { describe, it } from 'vitest'

import { matchFolderTransform } from '../../../../testUtils/matchFolderTransform'
import moveGeneratorTemplates from '../moveGeneratorTemplates'

describe('moveGeneratorTemplates', () => {
  it('Changes the structure of a redwood project', async () => {
    await matchFolderTransform(moveGeneratorTemplates, 'default')
  })
})
