import { Router, Route, PrivateSet } from '@cedarjs/router'

import { useAuth } from './auth'

import { tenancy } from 'src/tenancy'

const Routes = () => {
  return (
    <Router useAuth={useAuth} tenancy={tenancy}>
      <PrivateSet unauthenticated="login">
        <Route
          path="/org/{orgSlug}/projects"
          page={ProjectsPage}
          name="projects"
        />
      </PrivateSet>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
