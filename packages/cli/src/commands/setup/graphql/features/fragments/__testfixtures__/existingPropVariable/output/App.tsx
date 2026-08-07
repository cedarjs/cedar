import { FatalErrorBoundary, RedwoodProvider } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import possibleTypes from 'src/graphql/possibleTypes'

import FatalErrorPage from 'src/pages/FatalErrorPage'
import Routes from 'src/Routes'

import { AuthProvider, useAuth } from './auth.js'

import './scaffold.css'
import './index.css'

const graphQLClientConfig = {
  uri: '/graphql',
  cacheConfig: {
    resultCaching: true,
    resultCacheMaxSize: 1024,
    possibleTypes: possibleTypes.possibleTypes,
  },
}

const App = () => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <RedwoodProvider titleTemplate="%PageTitle | %AppTitle">
      <AuthProvider>
        <CedarApolloProvider
          useAuth={useAuth}
          graphQLClientConfig={graphQLClientConfig}
        >
          <Routes />
        </CedarApolloProvider>
      </AuthProvider>
    </RedwoodProvider>
  </FatalErrorBoundary>
)

export default App
