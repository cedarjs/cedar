import { Router, Route } from '@cedarjs/router'
import type { OrgMembership } from '@cedarjs/tenancy/web'
import { useCurrentOrg } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <Router paramTypes={{}} useAuth={useAuth} trailingSlashes="always">
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
