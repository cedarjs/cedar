import { Router, Route } from '@cedarjs/router'
import { useOrgRoles } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <Router useAuth={useAuth} useOrgRoles={useOrgRoles} trailingSlashes="always">
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
