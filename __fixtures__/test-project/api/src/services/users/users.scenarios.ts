import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, User } from 'src/lib/db'
export const standard = defineScenario<Prisma.UserCreateArgs>({
  user: {
  user: {
    one: {
    one: {
      data: {
      data: {
        email: 'foo9@bar.com',
        email: 'foo9@bar.com',
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
        email: 'foo17@bar.com',
        email: 'foo17@bar.com',
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
