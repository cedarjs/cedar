import { Router, Route } from '@cedarjs/router'
import { useAuth } from './auth'

import { tenancy } from 'src/tenancy'

const Routes = () => {
  return (
    <Router useAuth={useAuth} tenancy={tenancy} trailingSlashes="always">
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
