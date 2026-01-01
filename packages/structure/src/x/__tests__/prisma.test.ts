import { describe, it, expect } from 'vitest'

import { prisma_parseEnvExpressions } from '../prisma'
import { Range_create } from '../Range'

describe('prisma_parseEnvExpressions', () => {
  it('can find env() expressions in a prisma schema', () => {
    const [r] = Array.from(prisma_parseEnvExpressions(`env("foo") `))
    const range = Range_create(0, 0, 0, 10)
    expect(r).toEqual({ range, key: 'foo' })
  })
})
