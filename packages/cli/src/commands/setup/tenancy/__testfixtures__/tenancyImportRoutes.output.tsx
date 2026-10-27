import { Router as AppRouter, Route } from '@cedarjs/router'
import type { OrgMembership } from '@cedarjs/tenancy/web'
import { useCurrentOrg, useOrgRoles } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <AppRouter
      paramTypes={{}}
      useAuth={useAuth}
      useOrgRoles={useOrgRoles}
      trailingSlashes="always"
    >
      <Route notfound page={NotFoundPage} />
    </AppRouter>
  )
}

export default Routes
