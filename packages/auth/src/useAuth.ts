import React from 'react'

import type { AuthContextInterface } from './AuthContext.js'
import { HasPermissionContext } from './HasPermissionContext.js'

export function createUseAuth<
  TUser,
  TLogInOptions,
  TLogIn,
  TLogOutOptions,
  TLogOut,
  TSignUpOptions,
  TSignUp,
  TForgotPassword,
  TResetPasswordOptions,
  TResetPassword,
  TValidateResetToken,
  TClient,
  TChangePasswordOptions = unknown,
  TChangePassword = unknown,
>(
  AuthContext: React.Context<
    | AuthContextInterface<
        TUser,
        TLogInOptions,
        TLogIn,
        TLogOutOptions,
        TLogOut,
        TSignUpOptions,
        TSignUp,
        TForgotPassword,
        TResetPasswordOptions,
        TResetPassword,
        TValidateResetToken,
        TClient,
        TChangePasswordOptions,
        TChangePassword
      >
    | undefined
  >,
) {
  const useAuth = (): AuthContextInterface<
    TUser,
    TLogInOptions,
    TLogIn,
    TLogOutOptions,
    TLogOut,
    TSignUpOptions,
    TSignUp,
    TForgotPassword,
    TResetPasswordOptions,
    TResetPassword,
    TValidateResetToken,
    TClient,
    TChangePasswordOptions,
    TChangePassword
  > => {
    const context = React.useContext(AuthContext)
    const hasPermission = React.useContext(HasPermissionContext)
    const scoped = React.useMemo(
      () =>
        context && hasPermission ? { ...context, hasPermission } : context,
      [context, hasPermission],
    )

    if (!scoped) {
      throw new Error('useAuth must be used within an AuthProvider')
    }

    return scoped
  }

  return useAuth
}

export function useNoAuth(): AuthContextInterface<
  null,
  void,
  void,
  void,
  void,
  void,
  void,
  void,
  void,
  void,
  void,
  undefined,
  void,
  void
> {
  return {
    loading: false,
    isAuthenticated: false,
    logIn: async () => {},
    logOut: async () => {},
    signUp: async () => {},
    currentUser: null,
    userMetadata: null,
    getToken: async () => null,
    getCurrentUser: async () => null,
    hasRole: () => false,
    hasPermission: () => false,
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

export type UseAuth = () => AuthContextInterface<
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
  unknown,
  unknown,
  unknown
>
