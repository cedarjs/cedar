import type { MockCurrentUser } from '@cedarjs/testing/api'

import type { Prisma, Post } from 'src/lib/db'

export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
    one: {
      data: {},
    },
  },
})

export type StandardScenario = ScenarioData<Post, 'post'>
export type CurrentUser = MockCurrentUser
