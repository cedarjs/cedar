import React from 'react'

import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { HasPermissionContext } from '../HasPermissionContext.js'
import { HasRoleContext } from '../HasRoleContext.js'

import { createCustomTestAuth } from './fixtures/customTestAuth.js'

const { AuthProvider, useAuth } = createCustomTestAuth({
  login: () => true,
  signup: () => {},
  logout: () => {},
  getToken: vi.fn(),
  getUserMetadata: vi.fn(),
  forgotPassword: () => {},
  resetPassword: () => true,
  validateResetToken: () => ({}),
  changePassword: () => true,
})

describe('HasPermissionContext', () => {
  test('useAuth().hasPermission is false without it', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(result.current.hasPermission('members.manage')).toBe(false)
  })

  test('provides useAuth().hasPermission below it', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <AuthProvider>
          <HasPermissionContext.Provider
            value={(permission) => permission === 'members.manage'}
          >
            {children}
          </HasPermissionContext.Provider>
        </AuthProvider>
      ),
    })

    expect(result.current.hasPermission('members.manage')).toBe(true)
    expect(result.current.hasPermission('billing.manage')).toBe(false)
    // hasRole is still the provider's
    expect(result.current.hasRole('owner')).toBe(false)
  })

  test('works next to HasRoleContext', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <AuthProvider>
          <HasRoleContext.Provider value={() => true}>
            <HasPermissionContext.Provider value={() => true}>
              {children}
            </HasPermissionContext.Provider>
          </HasRoleContext.Provider>
        </AuthProvider>
      ),
    })

    expect(result.current.hasRole('owner')).toBe(true)
    expect(result.current.hasPermission('members.manage')).toBe(true)
  })
})
