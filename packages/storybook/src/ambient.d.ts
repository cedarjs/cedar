// Virtual module alias resolved by Vite to the user's Routes file
declare module '~__CEDAR__USER_ROUTES_FOR_MOCK' {
  import type React from 'react'
  const Routes: React.FC
  export default Routes
}

// Virtual module resolved by the `mock-org-clients` Vite plugin to
// `clearOrgClients` from the app's `@cedarjs/tenancy/web`, or a no-op
declare module '~__CEDAR__ORG_CLIENTS_FOR_MOCK' {
  export const clearOrgClients: () => Promise<void>
}
