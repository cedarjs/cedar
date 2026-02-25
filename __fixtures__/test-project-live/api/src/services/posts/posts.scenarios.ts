import type { ScenarioData } from '@cedarjs/testing/api'

import type { Prisma, Post } from 'src/lib/db'
export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
  post: {
    one: {
    one: {
      data: {
      data: {
        title: 'String',
        title: 'String',
        body: 'String',
        body: 'String',
        author: {
        author: {
          create: {
          create: {
            email: 'foo13@bar.com',
            email: 'foo13@bar.com',
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
    },
    },
    two: {
    two: {
      data: {
      data: {
        title: 'String',
        title: 'String',
        body: 'String',
        body: 'String',
        author: {
        author: {
          create: {
          create: {
            email: 'foo27@bar.com',
            email: 'foo27@bar.com',
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
    },
    },
  },
  },
})
})


export type StandardScenario = ScenarioData<Post, 'post'>
export type StandardScenario = ScenarioData<Post, 'post'>
