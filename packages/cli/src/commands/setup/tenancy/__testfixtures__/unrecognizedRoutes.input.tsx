import { Route } from '@cedarjs/router'

import { AppRouter } from './AppRouter'
import { useAuth } from './auth'

const Routes = () => {
  return (
    <AppRouter useAuth={useAuth}>
      <Route notfound page={NotFoundPage} />
    </AppRouter>
  )
}

export default Routes
