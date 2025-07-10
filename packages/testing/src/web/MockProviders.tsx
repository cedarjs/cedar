/**
 * NOTE: This module should not contain any nodejs functionality,
 * because it's also used by Storybook in the browser.
 */
import React from 'react'

import { LocationProvider } from '@cedarjs/router'
import { RedwoodProvider } from '@cedarjs/web'
import { RedwoodApolloProvider } from '@cedarjs/web/apollo'

import { useAuth } from './mockAuth.js'
import { MockParamsProvider } from './MockParamsProvider.js'

// Import the user's Routes from `./web/src/Routes.{tsx,jsx}`,
// we pass the `children` from the user's Routes to `./MockRouter.Router`
// so that we can populate the `routes object` in Storybook and tests.
let UserRoutes: React.FC

// we need to do this to avoid "Could not resolve "~__REDWOOD__USER_ROUTES_FOR_MOCK"" errors
try {
  const userRoutesModule = require('~__REDWOOD__USER_ROUTES_FOR_MOCK')
  UserRoutes = userRoutesModule.default
} catch (error) {
  if (!isModuleNotFoundError(error, '~__REDWOOD__USER_ROUTES_FOR_MOCK')) {
    // if it's not "MODULE_NOT_FOUND" it's more likely a user error. Let's
    // surface that to help the user debug the issue.
    console.warn(error)
  }

  UserRoutes = () => <></>
}

// TODO(pc): see if there are props we want to allow to be passed into our mock provider (e.g. AuthProviderProps)
export const MockProviders: React.FunctionComponent<{
  children: React.ReactNode
}> = ({ children }) => {
  return (
    <RedwoodProvider titleTemplate="%PageTitle | %AppTitle">
      <RedwoodApolloProvider useAuth={useAuth}>
        <UserRoutes />
        <LocationProvider>
          <MockParamsProvider>{children}</MockParamsProvider>
        </LocationProvider>
      </RedwoodApolloProvider>
    </RedwoodProvider>
  )
}

function isModuleNotFoundError(error: unknown, module: string) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'MODULE_NOT_FOUND' &&
    'moduleName' in error &&
    error.moduleName === module
  )
}
