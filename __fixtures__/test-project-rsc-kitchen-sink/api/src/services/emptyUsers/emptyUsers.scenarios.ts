import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, EmptyUser } from 'src/lib/db'

export const standard = defineScenario<Prisma.EmptyUserCreateArgs>({
  emptyUser: {
    one: { data: { email: 'String5770021' } },
    two: { data: { email: 'String5278315' } },
  },
})

export type StandardScenario = ScenarioData<EmptyUser, 'emptyUser'>
