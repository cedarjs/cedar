import { Router, Route } from '@cedarjs/router'

import HomePage from 'src/pages/HomePage'
import NotFoundPage from 'src/pages/NotFoundPage'

const Routes = () => {
  return (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
