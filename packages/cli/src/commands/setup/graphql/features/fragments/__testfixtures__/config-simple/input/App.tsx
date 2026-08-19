import { FatalErrorBoundary, CedarProvider } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import possibleTypes from 'src/graphql/possibleTypes'

import FatalErrorPage from 'src/pages/FatalErrorPage'
import Routes from 'src/Routes'

import './scaffold.css'
import './index.css'

const App = () => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <CedarProvider titleTemplate="%PageTitle | %AppTitle">
      <CedarApolloProvider>
        <Routes />
      </CedarApolloProvider>
    </CedarProvider>
  </FatalErrorBoundary>
)

export default App
