import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, Contact } from 'src/lib/db'
export const standard = defineScenario<Prisma.ContactCreateArgs>({
  contact: {
  contact: {
    one: { data: { name: 'String', email: 'foo@bar.com', message: 'String' } },
    one: { data: { name: 'String', email: 'foo@bar.com', message: 'String' } },
    two: { data: { name: 'String', email: 'foo@bar.com', message: 'String' } },
    two: { data: { name: 'String', email: 'foo@bar.com', message: 'String' } },
  },
  },
})
})


export type StandardScenario = ScenarioData<Contact, 'contact'>
export type StandardScenario = ScenarioData<Contact, 'contact'>
