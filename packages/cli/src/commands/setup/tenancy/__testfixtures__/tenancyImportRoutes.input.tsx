import { Router as AppRouter, Route } from '@cedarjs/router'
import type { OrgMembership } from '@cedarjs/tenancy/web'
import { useCurrentOrg } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <AppRouter paramTypes={{}} useAuth={useAuth} trailingSlashes="always">
      <Route notfound page={NotFoundPage} />
    </AppRouter>
  )
}

export default Routes
