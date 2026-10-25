import type { Decoded } from '@cedarjs/api'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { db } from './db.js'

export const cookieName = 'session_%port%'

export const getCurrentUser = async (session: Decoded) => {
  if (!session || typeof session.id !== 'string') {
    throw new Error('Invalid session')
  }

  return await db.user.findUnique({
    where: { id: session.id },
    select: { id: true },
  })
}

export const isAuthenticated = (): boolean => {
  return !!context.currentUser
}
