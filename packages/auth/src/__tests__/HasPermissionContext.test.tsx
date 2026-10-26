import React from 'react'

import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { HasPermissionContext } from '../HasPermissionContext.js'

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

// Without permission names (an app's are generated), `hasPermission` takes
// `never`, so calling it is a type error; these tests call it anyway
const hasPermission = (auth: { hasPermission: unknown }) =>
  auth.hasPermission as (permission: string) => boolean

describe('HasPermissionContext', () => {
  test('useAuth().hasPermission is false without it', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(hasPermission(result.current)('members.manage')).toBe(false)
  })

  test('hasPermission takes no names in an app without permissions', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    // @ts-expect-error - there are no permission names to pass
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

    expect(hasPermission(result.current)('members.manage')).toBe(true)
    expect(hasPermission(result.current)('billing.manage')).toBe(false)
    // hasRole is still the provider's
    expect(result.current.hasRole('owner')).toBe(false)
  })
})
