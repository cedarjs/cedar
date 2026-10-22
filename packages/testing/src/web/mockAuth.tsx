import React from 'react'

// Exporting everything here, but exports further down in this file will
// override exports with the same name
export * from '@cedarjs/auth'

import { mockedUserMeta } from './mockRequests.js'

interface Props {
  children: React.ReactNode
}

const AuthProvider: React.FC<Props> = ({ children }) => {
  return <>{children}</>
}

function makeArray<T>(input?: T | T[]) {
  return !input ? [] : Array.isArray(input) ? input : [input]
}

// When running tests, this is what they'll get when they import `useAuth`
// thanks to the router import transform in the Vitest setup
export function useAuth() {
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
    hasRole: (roles: string | string[]) => {
      const user = mockedUserMeta.currentUser
      // `CurrentUser` accepts primitives now that `LoggedInUser` has no index
      // signature, and `in` throws on anything that isn't an object, so
      // guard on `typeof` before using it (see useHasRole.ts).
      const currentUserRoles = makeArray(
        user && typeof user === 'object' && 'roles' in user
          ? (user.roles as string | string[] | undefined)
          : undefined,
      )

      if (currentUserRoles) {
        return makeArray(roles).some((role) => currentUserRoles.includes(role))
      }

      return false
    },
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
