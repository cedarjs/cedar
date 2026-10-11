// In this file, all Page components from 'src/pages` are auto-imported. Nested
// directories are supported, and should be uppercase. Each subdirectory will be
// prepended onto the component name.
//
// Examples:
//
// 'src/pages/HomePage/HomePage.js'         -> HomePage
// 'src/pages/Admin/BooksPage/BooksPage.js' -> AdminBooksPage

import { Route } from '@cedarjs/router/Route'
import { Router } from '@cedarjs/router/RscRouter'
import { Set, PrivateSet } from '@cedarjs/router/Set'

import { useAuth } from './auth'
import AuthLayout from './layouts/AuthLayout/AuthLayout'
import BlogLayout from './layouts/BlogLayout/BlogLayout'
import EmptyUsersScaffoldLayout from './layouts/EmptyUsersScaffoldLayout/EmptyUsersScaffoldLayout'
import NavigationLayout from './layouts/NavigationLayout/NavigationLayout'
import UserExamplesScaffoldLayout from './layouts/UserExamplesScaffoldLayout/UserExamplesScaffoldLayout'

const Routes = () => {
  return (
    <Router useAuth={useAuth}>
      <Set wrap={NavigationLayout}>
        <Route path="/" page={HomePage} name="home" />
        <Route path="/about" page={AboutPage} name="about" />
        <Route path="/multi-cell" page={MultiCellPage} name="multiCell" />

        <Set wrap={BlogLayout}>
          <Route path="/blog/new" page={NewBlogPostPage} name="newBlogPost" />
          <Route path="/blog/{slug}/edit" page={EditBlogPostPage} name="editBlogPost" />
          <Route path="/blog/{slug}" page={BlogPostPage} name="blogPost" />
          <Route path="/blog" page={BlogPage} name="blog" />
        </Set>

        <Set wrap={AuthLayout}>
          <Route path="/request" page={RequestPage} name="request" />
          <Route path="/login" page={LoginPage} name="login" />
          <Route path="/signup" page={SignupPage} name="signup" />
          <Route path="/forgot-password" page={ForgotPasswordPage} name="forgotPassword" />
          <Route path="/reset-password" page={ResetPasswordPage} name="resetPassword" />
          <PrivateSet unauthenticated="login">
            <Route path="/profile" page={ProfilePage} name="profile" />
          </PrivateSet>
        </Set>

        <Set wrap={EmptyUsersScaffoldLayout}>
          <Route path="/empty-users/new" page={EmptyUserNewEmptyUserPage} name="newEmptyUser" />
          <Route path="/empty-users/{id:Int}/edit" page={EmptyUserEditEmptyUserPage} name="editEmptyUser" />
          <Route path="/empty-users/{id:Int}" page={EmptyUserEmptyUserPage} name="emptyUser" />
          <Route path="/empty-users" page={EmptyUserEmptyUsersPage} name="emptyUsers" />
        </Set>

        <Set wrap={UserExamplesScaffoldLayout}>
          <Route path="/user-examples/new" page={UserExampleNewUserExamplePage} name="newUserExample" />
          <Route path="/user-examples/{id:Int}/edit" page={UserExampleEditUserExamplePage} name="editUserExample" />
          <Route path="/user-examples/{id:Int}" page={UserExampleUserExamplePage} name="userExample" />
          <Route path="/user-examples" page={UserExampleUserExamplesPage} name="userExamples" />
        </Set>
      </Set>
      <Route notfound page={NotFoundPage} />
    </Router>
  )
}

export default Routes
