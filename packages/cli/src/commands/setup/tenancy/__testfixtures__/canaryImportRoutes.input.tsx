import { Router, Route } from '@cedarjs/router'
import { useCurrentOrg, useOrgRoles } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <Router useAuth={useAuth} useOrgRoles={useOrgRoles}>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
