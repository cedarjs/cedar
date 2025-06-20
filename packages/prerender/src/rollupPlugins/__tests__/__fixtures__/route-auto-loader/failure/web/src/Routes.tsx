import { Router, Route } from '@cedarjs/router'

const Routes = () => {
  return (
    <Router>
      <Route path="/" page={HomePage} name="home"/>
    </Router>
  )
}

export default Routes
