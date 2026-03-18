import { describe, it } from 'vitest'

import { matchTransformSnapshot } from '../../../../../testUtils/matchTransformSnapshot.js'

describe('clerk', () => {
  it('updates the getCurrentUser function', async () => {
    await matchTransformSnapshot('updateClerkGetCurrentUser', 'default')
  })
})
