import React from 'react'

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { HasPermissionContext } from '@cedarjs/auth'

import { useAuth } from '../mockAuth.js'
import { mockCurrentUser } from '../mockRequests.js'

describe('mockAuth useAuth', () => {
  afterEach(() => {
    mockCurrentUser(null)
  })

  it("checks the mocked user's roles, and no permissions, by default", () => {
    mockCurrentUser({ id: 1, roles: ['admin'] })

    const { result } = renderHook(() => useAuth())

    expect(result.current.hasRole('admin')).toBe(true)
    expect(result.current.hasRole('owner')).toBe(false)
    expect(result.current.hasPermission('members.manage')).toBe(false)
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
