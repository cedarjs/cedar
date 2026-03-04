import { describe, it } from 'vitest'

import { matchFolderTransform } from '../../../../../testUtils/matchFolderTransform.js'
import { updateGraphqlConfig } from '../updateGraphqlConfig.js'

describe('updateGraphQLConfig', () => {
  it('Replaces graphql.config.js with a new version downloaded from GH', async () => {
    await matchFolderTransform(updateGraphqlConfig)
  })
})
