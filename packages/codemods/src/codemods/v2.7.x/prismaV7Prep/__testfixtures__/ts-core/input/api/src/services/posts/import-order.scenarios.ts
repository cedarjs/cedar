import type { Prisma, Post } from '@prisma/client'

import type { MockCurrentUser } from '@cedarjs/testing/api'

export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
    one: {
      data: {},
    },
  },
})

export type StandardScenario = ScenarioData<Post, 'post'>
export type CurrentUser = MockCurrentUser
