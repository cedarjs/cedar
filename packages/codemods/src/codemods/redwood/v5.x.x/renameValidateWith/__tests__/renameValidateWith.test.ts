import { describe, it } from 'vitest'

import { matchTransformSnapshot } from '../../../../../testUtils/matchTransformSnapshot.js'

describe('renameValidateWith', () => {
  it('Renames `validateWith` to `validateWithSync`', async () => {
    await matchTransformSnapshot('renameValidateWith', 'default')
  })
})
