// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { AuthContextInterface, UseAuth } from '@cedarjs/auth'

import type { OrgMembership } from '../types.js'
import { useOrgBySlug } from '../useOrgBySlug.js'

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

function orgFor(useAuth: UseAuth, orgSlug: string | undefined) {
  return renderHook(() => useOrgBySlug(useAuth, orgSlug)).result.current
}

describe('useOrgBySlug', () => {
  test('is null without a slug', () => {
    expect(orgFor(memberOfTwo, undefined)).toBeNull()
  })

  test("finds the user's membership in the organization with the slug", () => {
    const inOrgA = orgFor(memberOfTwo, 'org-a')
    const inOrgB = orgFor(memberOfTwo, 'org-b')

    expect(inOrgA?.membership?.organizationId).toBe('org_a')
    expect(inOrgA?.membership?.role).toBe('member')
    expect(inOrgB?.membership?.organizationId).toBe('org_b')
    expect(inOrgB?.membership?.role).toBe('owner')
  })

  test('has all the memberships', () => {
    expect(orgFor(memberOfTwo, 'org-a')?.memberships).toHaveLength(2)
  })

  test('has no membership in an organization the user is not a member of', () => {
    const org = orgFor(memberOfTwo, 'org-c')

    expect(org).not.toBeNull()
    expect(org?.membership).toBeNull()
  })

  test('has no membership when the user is not signed in', () => {
    const org = orgFor(createUseAuth(false, null), 'org-a')

    expect(org).not.toBeNull()
    expect(org?.membership).toBeNull()
    expect(org?.memberships).toEqual([])
  })

  test('ignores memberships that are left over after signing out', () => {
    const staleUser = createUseAuth(false, {
      id: 'user_1',
      memberships: [membership('org_a', 'org-a', 'owner')],
    })

    expect(orgFor(staleUser, 'org-a')?.membership).toBeNull()
  })
})
