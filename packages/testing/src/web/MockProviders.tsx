import React from 'react'

import { LocationProvider } from '@cedarjs/router'
import { RedwoodProvider } from '@cedarjs/web'
import { RedwoodApolloProvider } from '@cedarjs/web/apollo'

import { UserRoutes } from './globRoutesImporter.js'
import { useAuth } from './mockAuth.js'
import { MockParamsProvider } from './MockParamsProvider.js'

// TODO(pc): see if there are props we want to allow to be passed into our mock
// provider (e.g. AuthProviderProps)
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
