import type { Prisma, Post } from '@prisma/client'

import type { MockCurrentUser } from '@cedarjs/testing/api'

import { cookieName, getCurrentUser } from 'src/lib/auth'
// This is a comment for the logger
import { logger } from 'src/lib/logger'
import { realtime } from 'src/lib/realtime'

test('defineScenario file to be able to import project files', () => {
  logger.info('defineScenario cookieName %s', cookieName)
  logger.info('defineScenario currentUser %o', getCurrentUser())
  logger.info('defineScenario realtime %o', realtime)
})

export const standard = defineScenario<Prisma.PostCreateArgs>({
  post: {
    one: {
      data: {},
    },
  },
})

export type StandardScenario = ScenarioData<Post, 'post'>
export type CurrentUser = MockCurrentUser
