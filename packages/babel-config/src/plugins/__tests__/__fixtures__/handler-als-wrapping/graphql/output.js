import { authDecoder } from '@cedarjs/auth-dbauth-api'
import { createGraphQLHandler } from '@cedarjs/graphql-server'
import directives from 'src/directives/**/*.{js,ts}'
import sdls from 'src/graphql/**/*.sdl.{js,ts}'
import services from 'src/services/**/*.{js,ts}'
import { getCurrentUser } from 'src/lib/auth'
import { db } from 'src/lib/db'
import { logger } from 'src/lib/logger'
import { getAsyncStoreInstance as __cedar_getAsyncStoreInstance } from '@cedarjs/context/dist/store'
const __cedar_handler = createGraphQLHandler({
  authDecoder,
  getCurrentUser,
  loggerConfig: {
    logger,
    options: {},
  },
  directives,
  sdls,
  services,
  onException: () => {
    // Disconnect from your database with an unhandled exception.
    db.$disconnect()
  },
})
export const handler = (__cedar_event, __cedar_context) => {
  // The store will be undefined if no context isolation has been performed yet
  const __cedar_contextStore = __cedar_getAsyncStoreInstance().getStore()
  if (__cedar_contextStore === undefined) {
    return __cedar_getAsyncStoreInstance().run(
      new Map(),
      __cedar_handler,
      __cedar_event,
      __cedar_context
    )
  }
  return __cedar_handler(__cedar_event, __cedar_context)
}