import { FatalErrorBoundary, CedarProvider } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import FatalErrorPage from 'src/pages/FatalErrorPage'
import Routes from 'src/Routes'

const App = ({ children }: { children?: React.ReactNode }) => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <CedarProvider titleTemplate="%PageTitle | %AppTitle">
      <CedarApolloProvider>
        {children ? children : <Routes />}
      </CedarApolloProvider>
    </CedarProvider>
  </FatalErrorBoundary>
)

export default App
