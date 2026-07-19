import { FatalErrorBoundary } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import FatalErrorPage from 'src/pages/FatalErrorPage'
import Routes from './Routes'

import './index.css'

const App = () => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <CedarApolloProvider>
      <Routes />
    </CedarApolloProvider>
  </FatalErrorBoundary>
)

export default App
