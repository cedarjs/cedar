import React from 'react'

import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

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

describe('HasRoleContext', () => {
  test('useAuth().hasRole checks currentUser.roles without it', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(result.current.hasRole('owner')).toBe(false)
  })

  test('replaces useAuth().hasRole below it', () => {
    const hasRole = (roles: string | string[]) =>
      (Array.isArray(roles) ? roles : [roles]).includes('owner')

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <AuthProvider>
          <HasRoleContext.Provider value={hasRole}>
            {children}
          </HasRoleContext.Provider>
        </AuthProvider>
      ),
    })

    expect(result.current.hasRole('owner')).toBe(true)
    expect(result.current.hasRole(['admin', 'owner'])).toBe(true)
    expect(result.current.hasRole('admin')).toBe(false)
    // The rest of the auth state is the provider's
    expect(result.current.isAuthenticated).toBe(false)
  })

  test('still needs an AuthProvider', () => {
    const consoleError = console.error
    console.error = () => {}

    expect(() =>
      renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <HasRoleContext.Provider value={() => true}>
            {children}
          </HasRoleContext.Provider>
        ),
      }),
    ).toThrow('useAuth must be used within an AuthProvider')

    console.error = consoleError
  })
})
