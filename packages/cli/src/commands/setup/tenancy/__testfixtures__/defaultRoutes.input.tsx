import { Router, Route, PrivateSet } from '@cedarjs/router'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <Router useAuth={useAuth}>
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
