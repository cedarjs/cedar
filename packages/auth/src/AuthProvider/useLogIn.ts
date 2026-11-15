import { useCallback } from 'react'

import type { AuthImplementation } from '../AuthImplementation.js'

import type { AuthProviderState } from './AuthProviderState.js'
import { spaDefaultAuthProviderState } from './AuthProviderState.js'
import type { useCurrentUser } from './useCurrentUser.js'
import { useReauthenticate } from './useReauthenticate.js'

export const useLogIn = <
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
    TClient
  >,
  setAuthProviderState: React.Dispatch<
    React.SetStateAction<AuthProviderState<TUser>>
  >,
  getCurrentUser: ReturnType<typeof useCurrentUser>,
) => {
  const reauthenticate = useReauthenticate(
    authImplementation,
    setAuthProviderState,
    getCurrentUser,
  )

  return useCallback(
    async (options?: TLogInOptions) => {
      setAuthProviderState(spaDefaultAuthProviderState)

      // `reauthenticate` runs on rejection too, because it is what takes
      // `loading` back to `false` after the reset above
      try {
        return await authImplementation.login(options)
      } finally {
        await reauthenticate()
      }
    },
    [authImplementation, reauthenticate, setAuthProviderState],
  )
}
