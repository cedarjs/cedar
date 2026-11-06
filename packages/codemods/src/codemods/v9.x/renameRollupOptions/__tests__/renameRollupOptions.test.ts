import { describe, it } from 'vitest'

import { matchTransformSnapshot } from '../../../../testUtils/matchTransformSnapshot.js'

describe('renameRollupOptions', () => {
  it('renames rollupOptions in build, worker and optimizeDeps', async () => {
    await matchTransformSnapshot('renameRollupOptions', 'default')
  })

  it('leaves objects that also set rolldownOptions alone', async () => {
    await matchTransformSnapshot('renameRollupOptions', 'bothKeys')
  })
})
