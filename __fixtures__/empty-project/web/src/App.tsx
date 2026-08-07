import { FatalErrorBoundary, RedwoodProvider } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import FatalErrorPage from 'src/pages/FatalErrorPage'
import Routes from 'src/Routes'

import './index.css'

const App = ({ children }) => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <RedwoodProvider titleTemplate="%PageTitle | %AppTitle">
      <CedarApolloProvider>
        {children ? children : <Routes />}
      </CedarApolloProvider>
    </RedwoodProvider>
  </FatalErrorBoundary>
)

export default App
