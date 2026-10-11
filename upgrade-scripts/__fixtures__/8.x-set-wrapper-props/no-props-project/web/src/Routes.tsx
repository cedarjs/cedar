import { Router, Route, Set, PrivateSet } from '@cedarjs/router'

import MainLayout from 'src/layouts/MainLayout'
import PostsScaffoldLayout from 'src/layouts/PostsScaffoldLayout'

const Routes = () => {
  return (
    <Router>
      <PrivateSet
        unauthenticated="home"
        roles="admin"
        whileLoadingAuth={() => null}
      >
        <Set wrap={PostsScaffoldLayout} key="posts">
          <Route path="/posts" page={PostPostsPage} name="posts" />
        </Set>
      </PrivateSet>
      <Set wrap={[MainLayout]} prerender whileLoadingPage={() => null}>
        <Route path="/" page={HomePage} name="home" />
      </Set>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
