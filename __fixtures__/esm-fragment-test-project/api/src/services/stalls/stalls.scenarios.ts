import type { Prisma, Stall } from '@prisma/client'

import type { ScenarioData } from '@cedarjs/testing/api'

export const standard = defineScenario<Prisma.StallCreateArgs>({
  stall: {
    one: { data: { name: 'String', stallNumber: 'String9136837' } },
    two: { data: { name: 'String', stallNumber: 'String9074776' } },
  },
})

export type StandardScenario = ScenarioData<Stall, 'stall'>
