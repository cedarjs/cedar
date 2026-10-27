import React from 'react'

import type { OrgContextValue } from './types.js'

/**
 * Carries the organization the router resolved for the current route.
 * Read through `useCurrentOrg()`; only defined under an organization route.
 */
export const OrgContext = React.createContext<OrgContextValue | undefined>(
  undefined,
)
