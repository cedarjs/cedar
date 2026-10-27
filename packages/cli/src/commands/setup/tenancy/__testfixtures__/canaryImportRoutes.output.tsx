import { Router, Route } from '@cedarjs/router'
import { useCurrentOrg } from '@cedarjs/tenancy/web'

import { useAuth } from './auth'

import { tenancy } from 'src/tenancy'

const Routes = () => {
  return (
    <Router useAuth={useAuth} tenancy={tenancy}>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
