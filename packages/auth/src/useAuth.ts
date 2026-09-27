import React from 'react'

import type { AuthContextInterface } from './AuthContext.js'

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

    if (!context) {
      throw new Error('useAuth must be used within an AuthProvider')
    }

    return context
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
