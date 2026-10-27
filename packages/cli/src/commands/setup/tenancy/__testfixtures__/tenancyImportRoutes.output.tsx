import { Router, Route } from '@cedarjs/router'
import type { OrgMembership } from '@cedarjs/tenancy/web'
import { useCurrentOrg } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

import { tenancy } from 'src/tenancy'

const Routes = () => {
  return (
    <Router
      paramTypes={{}}
      useAuth={useAuth}
      tenancy={tenancy}
      trailingSlashes="always"
    >
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
