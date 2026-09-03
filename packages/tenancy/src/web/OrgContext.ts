import React from 'react'

import type { OrgContextValue } from './types.js'

/**
 * Carries the organization `OrgScope` resolved for the current route.
 * Read through `useCurrentOrg()`; only defined under `OrgScope`.
 */
export const OrgContext = React.createContext<OrgContextValue | undefined>(
  undefined,
)
