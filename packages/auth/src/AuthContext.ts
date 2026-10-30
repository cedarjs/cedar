import React from 'react'

/**
 * The user returned by your app's `getCurrentUser` function on the api side,
 * when someone is logged in. Cedar generates the fields from your
 * `getCurrentUser` function.
 *
 * This is a declaration-merging target: Cedar's generated
 * `.cedar/types/includes/all-currentUser.d.ts` augments it with the app's
 * `getCurrentUser` return type. It has no fields of its own, so
 * `LoggedInUser` has exactly the fields `getCurrentUser` returns, and is `{}`
 * in apps where `getCurrentUser` doesn't return a user.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LoggedInUser {}

/**
 * What `getCurrentUser` returns: the logged-in user, or `null` when nobody is
 * logged in
 */
// `& object` keeps primitives out. Plain `LoggedInUser` is `{}` until it's
// augmented, and `{}` accepts any non-nullish value, strings included.
export type CurrentUser = (LoggedInUser & object) | null

/**
 * The app's permission names, as keys. Cedar generates them from the app's
 * permission definitions (`packages/permissions`, set up by
 * `cedar setup tenancy`). Empty when the app has none, and then
 * `hasPermission` takes nothing: it could only ever answer `false`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AvailablePermissions {}

/**
 * A permission name `hasPermission` takes: see `AvailablePermissions`.
 * `never` in an app without permissions, so calling it is a type error.
 */
export type PermissionName = [keyof AvailablePermissions] extends [never]
  ? never
  : Extract<keyof AvailablePermissions, string>

/**
 * Whether the app has tenancy (`cedar setup tenancy`). This is a
 * declaration-merging target: `cedar generate types` writes
 * `.cedar/types/includes/web-tenancy.d.ts`, which augments it with
 * `{ enabled: true }` in an app with tenancy. Empty otherwise.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AuthTenancy {}

export interface AuthContextInterface<
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
> {
  /** Determining your current authentication state */
  loading: boolean
  isAuthenticated: boolean
  /** The current user's data from the `getCurrentUser` function on the api side */
  currentUser: CurrentUser
  /**
   * The user's metadata from the auth service provider
   *
   * Exactly what this looks like will depend on the auth service provider,
   * but one example is this
   * ```json
   * {
   *   "id": "11111111-2222-3333-4444-5555555555555",
   *   "aud": "authenticated",
   *   "role": "authenticated",
   *   "email": "email@example.com",
   *   "app_metadata": {
   *     "provider": "email"
   *   },
   *   "user_metadata": null,
   *   "created_at": "2016-05-15T19:53:12.368652374-07:00",
   *   "updated_at": "2016-05-15T19:53:12.368652374-07:00"
   * }
   * ```
   */
  userMetadata: null | TUser
  logIn(options?: TLogInOptions): Promise<TLogIn>
  logOut(options?: TLogOutOptions): Promise<TLogOut>
  signUp(options?: TSignUpOptions): Promise<TSignUp>
  /**
   * Clients should always return null or string
   * It is expected that they catch any errors internally
   */
  getToken(): Promise<null | string>
  /**
   * Fetches the "currentUser" from the api side,
   * but does not update the current user state.
   */
  getCurrentUser(): Promise<CurrentUser>
  /**
   * Checks if the "currentUser" from the api side is assigned a role or one
   * of a list of roles. If the user is assigned any of the provided list of
   * roles, then hasRole is considered to be true.
   */
  hasRole(rolesToCheck: string | string[]): boolean
  /**
   * Whether the user has `permission` where they are in the app. Always
   * `false` outside a scope that provides permissions, such as an
   * organization route with `tenancy` from `@cedarjs/tenancy/web` on the
   * `Router`.
   */
  hasPermission(permission: PermissionName): boolean
  /**
   * Redetermine authentication state and update the state.
   */
  reauthenticate(): Promise<void>
  forgotPassword(username: string): Promise<TForgotPassword>
  resetPassword(options?: TResetPasswordOptions): Promise<TResetPassword>
  validateResetToken(resetToken: string | null): Promise<TValidateResetToken>
  /**
   * Changes the password of the currently logged in user. Auth providers
   * that support it verify the user's current password before setting the
   * new one.
   */
  changePassword(options?: TChangePasswordOptions): Promise<TChangePassword>
  /**
   * A reference to auth service provider sdk "client", which is useful if we
   * do not support some specific functionality.
   */
  client?: TClient
  type: string
  hasError: boolean
  error?: Error
}

export function createAuthContext<
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
>() {
  return React.createContext<
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
  >(undefined)
}
