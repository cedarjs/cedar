import type { Decoded } from '@cedarjs/api'
import { createTenancyAuth } from '@cedarjs/tenancy'

import { db } from './db.js'

export const cookieName = 'session_%port%'

export const getCurrentUser = async (session: Decoded) => {
  if (!session || typeof session.id !== 'string') {
    throw new Error('Invalid session')
  }

  return await db.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,

      memberships: {
        select: {
          id: true,
          organizationId: true,
          role: true,
          organization: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  })
}

export const isAuthenticated = (): boolean => {
  return !!context.currentUser
}

export const { hasRole, requireUserAuth } = createTenancyAuth()
