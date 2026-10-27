import React from 'react'

import type { UseOrg } from '@cedarjs/router'

import { getMemberships } from './getMemberships.js'
import { clearOrgClients, dropOrgClient } from './orgClients.js'

/**
 * Builds `{ organizationId: role }` for every membership, to detect when a
 * memberships refresh drops a membership.
 */
function membershipRoleMap(
  memberships: ReturnType<typeof getMemberships>,
): Map<string, string> {
  return new Map(memberships.map((m) => [m.organizationId, m.role]))
}

/** `currentUser.id`, which only exists when the app's `getCurrentUser` returns it */
export function getUserId(currentUser: unknown): string | undefined {
  if (
    currentUser &&
    typeof currentUser === 'object' &&
    'id' in currentUser &&
    typeof currentUser.id === 'string'
  ) {
    return currentUser.id
  }

  return undefined
}

/**
 * Clears the per-organization Apollo clients when the user signs out or
 * changes, and drops the client of an organization the user is no longer a
 * member of. (A role change is handled by `getOrgClient`.)
 *
 * It runs from the tenancy's `useOrg`, which the router calls for every
 * private route, so it still sees the change when the organization's
 * provider is no longer rendered because the user has signed out or left the
 * organization.
 */
export function useOrgClientTeardown(useAuth: Parameters<UseOrg>[0]) {
  const { isAuthenticated, currentUser } = useAuth()
  const userId = getUserId(currentUser)
  const memberships = getMemberships(currentUser)

  const membershipSignature = memberships
    .map((m) => `${m.organizationId}:${m.role}`)
    .sort()
    .join(',')

  // Tracks the user and memberships snapshot the client map was last torn
  // down for, so the effect below only reacts to real changes.
  const lastUserIdRef = React.useRef<string | undefined>(userId)
  const lastMembershipsRef = React.useRef<Map<string, string>>(
    membershipRoleMap(memberships),
  )

  React.useEffect(() => {
    const previousUserId = lastUserIdRef.current
    const userChanged =
      previousUserId !== undefined && previousUserId !== userId

    if (!isAuthenticated || userChanged) {
      lastUserIdRef.current = userId
      lastMembershipsRef.current = new Map()
      void clearOrgClients()
      return
    }

    lastUserIdRef.current = userId

    const nextMemberships = membershipRoleMap(memberships)

    if (userId) {
      for (const organizationId of lastMembershipsRef.current.keys()) {
        if (!nextMemberships.has(organizationId)) {
          void dropOrgClient(userId, organizationId)
        }
      }
    }

    lastMembershipsRef.current = nextMemberships
    // `membershipSignature` is `memberships` reduced to organization ids and
    // roles, which covers the ids this effect cares about, so it is the only
    // membership-derived dependency needed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userId, membershipSignature])
}
