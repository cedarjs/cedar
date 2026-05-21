/**
 * NOTE: This module should not contain any nodejs functionality,
 * because it's also used by Storybook in the browser.
 */
import React from 'react'

import { LocationProvider } from '@cedarjs/router'
import { useAuth } from '@cedarjs/testing/auth'
import { RedwoodProvider } from '@cedarjs/web'
import { RedwoodApolloProvider } from '@cedarjs/web/apollo'

import { MockParamsProvider } from './MockParamsProvider.js'

// Import the user's Routes from `./web/src/Routes.{tsx,jsx}`,
// we pass the `children` from the user's Routes to `./MockRouter.Router`
// so that we can populate the `routes object` in Storybook and tests.
//
// Use a static ESM import so Vite resolves the alias at transform time through
// its full plugin pipeline (including Cedar's Cell transform). A CJS require()
// in try/catch caused esbuild to inline the module during dep pre-bundling,
// which ran before Cedar's Cell plugin and produced missing default export
// errors for Cell files in the import chain.
import UserRoutes from '~__CEDAR__USER_ROUTES_FOR_MOCK'

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
