import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, User } from 'src/lib/db'

export const standard = defineScenario<Prisma.UserCreateArgs>({
  user: {
    one: {
      data: {
        email: 'foo9@bar.com',
        hashedPassword: 'String',
        fullName: 'String',
        salt: 'String',
      },
    },
    two: {
      data: {
        email: 'foo17@bar.com',
        hashedPassword: 'String',
        fullName: 'String',
        salt: 'String',
      },
    },
  },
})

export type StandardScenario = ScenarioData<User, 'user'>
