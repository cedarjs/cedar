import { Router, Route, Set, PrivateSet, Private } from '@cedarjs/router'

import BlogLayout from 'src/layouts/BlogLayout'
import MainLayout from 'src/layouts/MainLayout'
import ScaffoldLayout from 'src/layouts/ScaffoldLayout'
import ThemeLayout from 'src/layouts/ThemeLayout'

import { useAuth } from './auth'

const Routes = () => {
  return (
    <Router useAuth={useAuth}>
      <Set
        wrap={ScaffoldLayout}
        title="Posts"
        titleTo="posts"
        buttonLabel="New Post"
        buttonTo="newPost"
        prerender
      >
        <Route path="/posts" page={PostPostsPage} name="posts" />
      </Set>
      <Set
        wrap={[MainLayout, ThemeLayout]}
        theme="dark"
        whileLoadingPage={() => null}
      >
        <Route path="/" page={HomePage} name="home" />
      </Set>
      <PrivateSet
        wrap={MainLayout}
        unauthenticated="home"
        roles={['admin']}
        section="Admin"
      >
        <Route path="/admin" page={AdminPage} name="admin" />
      </PrivateSet>
      <Private unauthenticated="home" title="Private">
        <Route path="/private" page={PrivatePage} name="private" />
      </Private>
      <Set wrap={BlogLayout} prerender>
        <Route path="/blog" page={BlogPage} name="blog" />
      </Set>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
