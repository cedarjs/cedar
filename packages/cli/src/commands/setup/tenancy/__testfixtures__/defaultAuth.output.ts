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

type AllowedRoles = string | string[] | undefined

export const hasRole = (roles: AllowedRoles): boolean => {
  if (!isAuthenticated()) {
    return false
  }

  const currentUserRoles = context.currentUser?.roles as string | string[]

  if (typeof roles === 'string') {
    if (typeof currentUserRoles === 'string') {
      return currentUserRoles === roles
    } else if (Array.isArray(currentUserRoles)) {
      return currentUserRoles?.some((allowedRole) => roles === allowedRole)
    }
  }

  if (Array.isArray(roles)) {
    if (Array.isArray(currentUserRoles)) {
      return currentUserRoles?.some((allowedRole) =>
        roles.includes(allowedRole)
      )
    } else if (typeof currentUserRoles === 'string') {
      return roles.some((allowedRole) => currentUserRoles === allowedRole)
    }
  }

  return false
}

export const requireAuth = ({ roles }: { roles?: AllowedRoles } = {}) => {
  if (!isAuthenticated()) {
    throw new AuthenticationError("You don't have permission to do that.")
  }

  if (roles && !hasRole(roles)) {
    throw new ForbiddenError("You don't have access to do that.")
  }
}
export { hasOrgRole, requireMembership } from '@cedarjs/tenancy'
