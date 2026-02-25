import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, User } from 'src/lib/db'
export const standard = defineScenario<Prisma.UserCreateArgs>({
  user: {
  user: {
    one: {
    one: {
      data: {
      data: {
        email: 'String9',
        email: 'String9',
        hashedPassword: 'String',
        hashedPassword: 'String',
        fullName: 'String',
        fullName: 'String',
        salt: 'String',
        salt: 'String',
      },
      },
    },
    },
    two: {
    two: {
      data: {
      data: {
        email: 'String17',
        email: 'String17',
        hashedPassword: 'String',
        hashedPassword: 'String',
        fullName: 'String',
        fullName: 'String',
        salt: 'String',
        salt: 'String',
      },
      },
    },
    },
  },
  },
})
})


export type StandardScenario = ScenarioData<User, 'user'>
export type StandardScenario = ScenarioData<User, 'user'>
