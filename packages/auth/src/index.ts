export type {
  AuthContextInterface,
  AuthTenancy,
  AvailablePermissions,
  CurrentUser,
  LoggedInUser,
  PermissionName,
} from './AuthContext.js'
export type { AuthProviderProps } from './AuthProvider/AuthProvider.js'
export { HasPermissionContext } from './HasPermissionContext.js'
export { useNoAuth } from './useAuth.js'
export type { UseAuth } from './useAuth.js'
export { createAuthentication } from './authFactory.js'
export type { CustomProviderHooks } from './authFactory.js'
export type { AuthImplementation } from './AuthImplementation.js'

export {
  spaDefaultAuthProviderState,
  middlewareDefaultAuthProviderState,
} from './AuthProvider/AuthProviderState.js'
export type { AuthProviderState } from './AuthProvider/AuthProviderState.js'

export { getCurrentUserFromMiddleware } from './getCurrentUserFromMiddleware.js'
