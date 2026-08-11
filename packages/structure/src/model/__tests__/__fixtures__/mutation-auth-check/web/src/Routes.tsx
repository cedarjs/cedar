import { Router, Route, PrivateSet, Set } from '@cedarjs/router'

const Routes = () => {
  return (
    <Router>
      <Route path="/" page={HomePage} name="home" />
      <Route path="/admin/posts" page={AdminPostsPage} name="adminPosts" />
      <PrivateSet unauthenticated="home">
        <Set wrap={SomeLayout}>
          <Route
            path="/admin/posts-protected"
            page={AdminPostsProtectedPage}
            name="adminPostsProtected"
          />
        </Set>
      </PrivateSet>
      <Route
        path="/admin/posts-transitive"
        page={AdminPostsTransitivePage}
        name="adminPostsTransitive"
      />
      <Route
        path="/admin/posts-skip-auth"
        page={AdminPostsSkipAuthPage}
        name="adminPostsSkipAuth"
      />
      <Route
        path="/admin/posts-query"
        page={AdminPostsQueryPage}
        name="adminPostsQuery"
      />
      <Route
        path="/admin/posts-cycle"
        page={AdminPostsCyclePage}
        name="adminPostsCycle"
      />
    </Router>
  )
}

export default Routes
