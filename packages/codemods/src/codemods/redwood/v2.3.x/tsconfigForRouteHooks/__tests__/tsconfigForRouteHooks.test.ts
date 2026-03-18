import { describe, it } from 'vitest'

import { matchFolderTransform } from '../../../../../testUtils/matchFolderTransform.js'
import addApiAliasToTsConfig from '../tsconfigForRouteHooks.js'

describe('tsconfigForRouteHooks', () => {
  it('Adds $api to web/tsconfig.json', async () => {
    await matchFolderTransform(addApiAliasToTsConfig, 'default')
  })
})
