import { describe, it } from 'vitest'

import { matchTransformSnapshot } from '../../../../../testUtils/matchTransformSnapshot.js'

describe('updateResolverTypes', () => {
  it('Converts PostResolvers to PostRelationResolvers>', async () => {
    await matchTransformSnapshot('updateResolverTypes', 'default')
  })
})
