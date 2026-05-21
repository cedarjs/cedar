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

// Import the user's Routes from `./web/src/Routes.{tsx,jsx}`. We pass the
// `children` from the user's Routes to `./MockRouter.Router` so that we can
// populate the `routes` object in Storybook and tests.
//
// Two parts to make this work correctly:
//
// 1. In preset.ts, storybook-framework-cedarjs is excluded from Vite's dep
//    pre-bundling (optimizeDeps). Without this exclusion, esbuild resolves
//    imports from this module during its dep optimization pass, which runs
//    before Cedar's Cell transform plugin. Cell files have no default export
//    at that point, so esbuild would silently produce undefined for Cell
//    components
//
// 2. A static ESM import ensures Vite resolves the alias at request time
//    through its full plugin pipeline (including Cedar's Cell transform).
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
