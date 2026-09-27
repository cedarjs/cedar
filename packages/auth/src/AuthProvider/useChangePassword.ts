import { useCallback } from 'react'

import type { AuthImplementation } from '../AuthImplementation.js'

export const useChangePassword = <
  TUser,
  TRestoreAuth,
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
  TChangePassword,
>(
  authImplementation: AuthImplementation<
    TUser,
    TRestoreAuth,
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
  >,
) => {
  return useCallback(
    async (options?: TChangePasswordOptions) => {
      if (authImplementation.changePassword) {
        return await authImplementation.changePassword(options)
      } else {
        throw new Error(
          `Auth client ${authImplementation.type} does not implement this function`,
        )
      }
    },
    [authImplementation],
  )
}
