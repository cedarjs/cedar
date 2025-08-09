import type { Prisma, Produce } from '@prisma/client'

import type { ScenarioData } from '@cedarjs/testing/api'

export const standard = defineScenario<Prisma.ProduceCreateArgs>({
  produce: {
    one: {
      data: {
        name: 'String2231134',
        quantity: 6978607,
        price: 9949534,
        region: 'String',
        stall: { create: { name: 'String', stallNumber: 'String9443378' } },
      },
    },
    two: {
      data: {
        name: 'String5325933',
        quantity: 9629727,
        price: 360315,
        region: 'String',
        stall: { create: { name: 'String', stallNumber: 'String8448512' } },
      },
    },
  },
})

export type StandardScenario = ScenarioData<Produce, 'produce'>
