globalThis.RWJS_ENV = {
  RWJS_API_GRAPHQL_URL: process.env.EXPO_PUBLIC_RWJS_API_GRAPHQL_URL!,
  RWJS_API_URL: process.env.EXPO_PUBLIC_API_URL!,
}
globalThis.RWJS_API_GRAPHQL_URL = process.env.EXPO_PUBLIC_RWJS_API_GRAPHQL_URL!
globalThis.RWJS_API_URL = process.env.EXPO_PUBLIC_API_URL!

import { createDbAuthClient, createAuth } from '@cedarjs/auth-dbauth-web'

const dbAuthClient = createDbAuthClient()

export const { AuthProvider, useAuth } = createAuth(dbAuthClient)
