import React from 'react'

import { OrgContext } from './OrgContext.js'
import type { OrgContextValue } from './types.js'

/**
 * Reads the organization the router resolved for the current route: the
 * current organization, the full memberships snapshot, a role check scoped
 * to it, and `setOrg` to switch organizations.
 *
 * Must be called from a component rendered by a `PrivateSet` whose route is
 * in an organization (by default, one with `{orgSlug}` in its path), with
 * `tenancy` on the `Router`.
 */
export function useCurrentOrg(): OrgContextValue {
  const context = React.useContext(OrgContext)

  if (!context) {
    throw new Error(
      'useCurrentOrg must be used under an organization route: in a ' +
        'component rendered by a PrivateSet whose route has `{orgSlug}` in ' +
        'its path, with `tenancy` on the Router',
    )
  }

  return context
}
