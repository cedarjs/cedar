import type { Prisma, Post } from "src/lib/db"

export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
    one: {
      data: {},
    },
  },
})

export type StandardScenario = ScenarioData<Post, 'post'>
