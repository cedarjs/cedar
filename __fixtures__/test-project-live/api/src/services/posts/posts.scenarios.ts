import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, Post } from 'src/lib/db'

export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
    one: {
      data: {
        title: 'String213',
        body: 'String',
        author: {
          create: {
            email: 'foo13@bar.com',
            hashedPassword: 'String',
            fullName: 'String',
            salt: 'String',
          },
        },
      },
    },
    two: {
      data: {
        title: 'String499',
        body: 'String',
        author: {
          create: {
            email: 'foo27@bar.com',
            hashedPassword: 'String',
            fullName: 'String',
            salt: 'String',
          },
        },
      },
    },
  },
})

export type StandardScenario = ScenarioData<Post, 'post'>
