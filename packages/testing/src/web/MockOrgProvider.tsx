import React from 'react'

import { useParams } from '@cedarjs/router'
import type { Tenancy } from '@cedarjs/router'

import { useAuth } from './mockAuth.js'
import { mockedTenancyMeta } from './mockTenancy.js'

interface Props {
  children: React.ReactNode
}

/**
 * Does what the router does on a `PrivateSet` whose route is in an
 * organization, with the app's own `tenancy`: its `useOrg` finds the
 * organization from the mocked user and route params, and its `OrgProvider`
 * provides it. So `useCurrentOrg()` and `useAuth().hasPermission` work in a
 * test or story as they do on the app's organization routes, with
 * `mockCurrentUser({ memberships })` and `mockRouteParams({ orgSlug })`.
 *
 * Without an organization (no `tenancy`, or a `useOrg` that finds none)
 * `children` render without a provider, and `useCurrentOrg()` throws. A
 * signed-in user who isn't a member gets the tenancy's `notAMember`.
 */
export const MockOrgProvider: React.FC<Props> = ({ children }) => {
  const tenancy = mockedTenancyMeta.tenancy

  if (!tenancy) {
    return <>{children}</>
  }

  return <TenancyOrgProvider tenancy={tenancy}>{children}</TenancyOrgProvider>
}

const TenancyOrgProvider: React.FC<Props & { tenancy: Tenancy }> = ({
  tenancy,
  children,
}) => {
  const params = useParams()
  const org = tenancy.useOrg(useAuth, params)

  if (!org) {
    return <>{children}</>
  }

  const { membership, memberships } = org

  if (!membership) {
    return <>{tenancy.notAMember ?? null}</>
  }

  return (
    <tenancy.OrgProvider
      key={membership.organizationId}
      useAuth={useAuth}
      membership={membership}
      memberships={memberships}
    >
      {children}
    </tenancy.OrgProvider>
  )
}
