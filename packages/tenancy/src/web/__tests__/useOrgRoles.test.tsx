// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { AuthContextInterface, UseAuth } from '@cedarjs/auth'

import type { OrgMembership } from '../types.js'
import { useOrgRoles } from '../useOrgRoles.js'

type UnknownAuthContextInterface = AuthContextInterface<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>

function membership(
  organizationId: string,
  slug: string,
  role: string,
): OrgMembership {
  return {
    id: `membership_${organizationId}`,
    organizationId,
    role,
    organization: { id: organizationId, slug, name: slug },
  }
}

function createUseAuth(
  isAuthenticated: boolean,
  currentUser: { id: string; memberships: OrgMembership[] } | null,
): UseAuth {
  return () => {
    const values: UnknownAuthContextInterface = {
      loading: false,
      isAuthenticated,
      userMetadata: null,
      currentUser,
      logIn: async () => null,
      logOut: async () => null,
      signUp: async () => null,
      getToken: async () => null,
      getCurrentUser: async () => null,
      hasRole: () => false,
      hasUserRole: () => false,
      hasPermission: () => false,
      reauthenticate: async () => {},
      client: undefined,
      type: 'custom',
      hasError: false,
      forgotPassword: async () => null,
      resetPassword: async () => null,
      validateResetToken: async () => null,
      changePassword: async () => null,
    }

    return values
  }
}

const memberOfTwo = createUseAuth(true, {
  id: 'user_1',
  memberships: [
    membership('org_a', 'org-a', 'member'),
    membership('org_b', 'org-b', 'owner'),
  ],
})

function orgRolesCheck(useAuth: UseAuth, params: Record<string, string>) {
  return renderHook(() => useOrgRoles(useAuth, params)).result.current
}

describe('useOrgRoles', () => {
  test('is null when the route has no orgSlug param', () => {
    expect(orgRolesCheck(memberOfTwo, {})).toBeNull()
    expect(orgRolesCheck(memberOfTwo, { id: '42' })).toBeNull()
  })

  test("checks the role in the organization with the route's slug", () => {
    const inOrgA = orgRolesCheck(memberOfTwo, { orgSlug: 'org-a' })
    const inOrgB = orgRolesCheck(memberOfTwo, { orgSlug: 'org-b' })

    expect(inOrgA?.('owner')).toBe(false)
    expect(inOrgA?.('member')).toBe(true)
    expect(inOrgB?.('owner')).toBe(true)
  })

  test('takes a list of roles', () => {
    const inOrgA = orgRolesCheck(memberOfTwo, { orgSlug: 'org-a' })

    expect(inOrgA?.(['owner', 'member'])).toBe(true)
    expect(inOrgA?.(['owner', 'admin'])).toBe(false)
  })

  test('is false in an organization the user is not a member of', () => {
    const check = orgRolesCheck(memberOfTwo, { orgSlug: 'org-c' })

    expect(check).not.toBeNull()
    expect(check?.('member')).toBe(false)
    expect(check?.([])).toBe(false)
  })

  test('is false when the user is not signed in', () => {
    const signedOut = createUseAuth(false, null)
    const check = orgRolesCheck(signedOut, { orgSlug: 'org-a' })

    expect(check).not.toBeNull()
    expect(check?.('member')).toBe(false)
  })

  test('ignores memberships that are left over after signing out', () => {
    const staleUser = createUseAuth(false, {
      id: 'user_1',
      memberships: [membership('org_a', 'org-a', 'owner')],
    })

    expect(orgRolesCheck(staleUser, { orgSlug: 'org-a' })?.('owner')).toBe(
      false,
    )
  })
})
