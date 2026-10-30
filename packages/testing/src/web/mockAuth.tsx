import React from 'react'

// Exporting everything here, but exports further down in this file will
// override exports with the same name
export * from '@cedarjs/auth'

import { HasPermissionContext } from '@cedarjs/auth'
import { currentUserHasRole } from '@cedarjs/auth/currentUserHasRole'

import { mockedUserMeta } from './mockRequests.js'

interface Props {
  children: React.ReactNode
}

const AuthProvider: React.FC<Props> = ({ children }) => {
  return <>{children}</>
}

// When running tests, this is what they'll get when they import `useAuth`
// thanks to the router import transform in the Vitest setup. Like the real
// `useAuth`, `hasPermission` comes from a scope above when one provides it
// (the organization provider from `@cedarjs/tenancy/web` does).
export function useAuth() {
  const scopedHasPermission = React.useContext(HasPermissionContext)
  return {
    loading: false,
    isAuthenticated: !!mockedUserMeta.currentUser,
    logIn: async () => {},
    logOut: async () => {},
    signUp: async () => {},
    currentUser: mockedUserMeta.currentUser,
    userMetadata: mockedUserMeta.currentUser,
    getToken: async () => null,
    getCurrentUser: async () => mockedUserMeta.currentUser,
    hasRole: (roles: string | string[]) =>
      currentUserHasRole(mockedUserMeta.currentUser, roles),
    hasPermission: scopedHasPermission ?? (() => false),
    reauthenticate: async () => {},
    forgotPassword: async () => {},
    resetPassword: async () => {},
    validateResetToken: async () => {},
    changePassword: async () => {},
    type: 'default',
    client: undefined,
    hasError: false,
  }
}

export const createAuthentication = () => {
  return { AuthProvider, useAuth }
}
