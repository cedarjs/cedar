import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, Contact } from 'src/lib/db'

export const standard = defineScenario<Prisma.ContactCreateArgs>({
  contact: {
    one: { data: { name: 'String', email: 'String', message: 'String' } },
    two: { data: { name: 'String', email: 'String', message: 'String' } },
  },
})

export type StandardScenario = ScenarioData<Contact, 'contact'>
