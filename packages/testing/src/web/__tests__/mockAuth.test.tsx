import React from 'react'

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { HasPermissionContext } from '@cedarjs/auth'

import { setMockPermissionDefinitions } from '../../permissions/mockPermissions.js'
import { useAuth } from '../mockAuth.js'
import { mockCurrentUser } from '../mockRequests.js'

describe('mockAuth useAuth', () => {
  afterEach(() => {
    mockCurrentUser(null)
    setMockPermissionDefinitions(undefined)
  })

  it("checks the mocked user's roles, and no permissions, by default", () => {
    mockCurrentUser({ id: 1, roles: ['admin'] })

    const { result } = renderHook(() => useAuth())

    expect(result.current.hasRole('admin')).toBe(true)
    expect(result.current.hasRole('owner')).toBe(false)
    expect(result.current.hasPermission('members.manage')).toBe(false)
  })

  it("gives the mocked user their roles' permissions from the app's map", () => {
    setMockPermissionDefinitions({
      permissions: ['members.manage', 'billing.manage'],
      roles: { admin: ['members.manage'] },
    })
    mockCurrentUser({ id: 1, roles: ['admin'] })

    const { result } = renderHook(() => useAuth())

    expect(result.current.hasPermission('members.manage')).toBe(true)
    expect(result.current.hasPermission('billing.manage')).toBe(false)
  })

  it('uses hasPermission from a scope above, and keeps hasRole on currentUser.roles', () => {
    mockCurrentUser({ id: 1, roles: ['admin'] })

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <HasPermissionContext.Provider
          value={(permission) => permission === 'members.manage'}
        >
          {children}
        </HasPermissionContext.Provider>
      ),
    })

    expect(result.current.hasRole('admin')).toBe(true)
    expect(result.current.hasRole('owner')).toBe(false)
    expect(result.current.hasPermission('members.manage')).toBe(true)
  })
})
