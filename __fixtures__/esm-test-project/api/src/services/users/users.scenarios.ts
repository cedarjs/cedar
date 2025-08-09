import type { Prisma, User } from '@prisma/client'

import type { ScenarioData } from '@cedarjs/testing/api'

export const standard = defineScenario<Prisma.UserCreateArgs>({
  user: {
    one: {
      data: {
        email: 'String9',
        hashedPassword: 'String',
        fullName: 'String',
        salt: 'String',
      },
    },
    two: {
      data: {
        email: 'String17',
        hashedPassword: 'String',
        fullName: 'String',
        salt: 'String',
      },
    },
  },
})

export type StandardScenario = ScenarioData<User, 'user'>
