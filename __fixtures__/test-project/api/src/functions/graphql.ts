import { createAuthDecoder } from '@cedarjs/auth-dbauth-api'
import { createGraphQLHandler } from '@cedarjs/graphql-server'

import directives from 'src/directives/**/*.{js,ts}'
import sdls from 'src/graphql/**/*.sdl.{js,ts}'
import services from 'src/services/**/*.{js,ts}'

import { cookieName, getCurrentUser } from 'src/lib/auth.js'
import { db } from 'src/lib/db.js'
import { logger } from 'src/lib/logger.js'

const authDecoder = createAuthDecoder(cookieName)

export const handler = createGraphQLHandler({
  authDecoder,
  getCurrentUser,
  loggerConfig: { logger, options: {} },
  directives,
  sdls,
  services,
  onException: () => {
    // Disconnect from your database with an unhandled exception.
    db.$disconnect()
  },
})
