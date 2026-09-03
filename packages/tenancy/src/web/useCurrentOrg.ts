import React from 'react'

import { OrgContext } from './OrgContext.js'
import type { OrgContextValue } from './types.js'

/**
 * Reads the organization `OrgScope` resolved for the current route: the
 * current organization, the full memberships snapshot, a role check scoped
 * to it, and `setOrg` to switch organizations.
 *
 * Must be called from a component rendered under `OrgScope`.
 */
export function useCurrentOrg(): OrgContextValue {
  const context = React.useContext(OrgContext)

  if (!context) {
    throw new Error('useCurrentOrg must be used within an OrgScope')
  }

  return context
}
