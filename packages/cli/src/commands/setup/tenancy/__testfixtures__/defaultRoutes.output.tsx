import { Router, Route, Set } from '@cedarjs/router'

import { useAuth } from './auth'
import OrgScope from './components/OrgScope/OrgScope'

import { useOrgRoles } from '@cedarjs/tenancy/web'

const Routes = () => {
  return (
    <Router useAuth={useAuth} useOrgRoles={useOrgRoles}>
      <Set wrap={OrgScope}>
        <Route path="/org/{orgSlug}/projects" page={ProjectsPage} name="projects" />
      </Set>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
