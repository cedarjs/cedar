import { Router, Route, Set } from '@cedarjs/router'

import MainLayout from 'src/layouts/MainLayout'

const Routes = () => {
  return (
    <Router>
      <Set wrap={MainLayout} someProp="value" {...{ spread: 'prop' }}>
        <Route path="/" page={HomePage} name="home" />
        <Set wrap={MainLayout}>
          <Route path="/nested" page={NestedPage} name="nested" />
        </Set>
      </Set>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
