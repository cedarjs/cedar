import type React from 'react'

// Virtual module alias resolved by Vite to the user's Routes file
declare module '~__REDWOOD__USER_ROUTES_FOR_MOCK' {
  const Routes: React.FC
  export default Routes
}
