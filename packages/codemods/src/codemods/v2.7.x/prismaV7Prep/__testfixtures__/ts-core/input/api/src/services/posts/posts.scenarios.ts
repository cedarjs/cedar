import type { Prisma, Post } from '@prisma/client'

export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
    one: {
      data: {},
    },
  },
})

export type StandardScenario = ScenarioData<Post, 'post'>
