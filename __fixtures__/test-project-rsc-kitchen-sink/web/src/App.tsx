import type { ReactNode } from 'react'

import { FatalErrorBoundary, RedwoodProvider } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import { AuthProvider, useAuth } from './auth'
import FatalErrorPage from './pages/FatalErrorPage/FatalErrorPage'

import './index.css'
import './scaffold.css'

interface AppProps {
  children?: ReactNode
}

const App = ({ children }: AppProps) => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <RedwoodProvider titleTemplate="%PageTitle | %AppTitle">
      <AuthProvider>
        <CedarApolloProvider useAuth={useAuth}>{children}</CedarApolloProvider>
      </AuthProvider>
    </RedwoodProvider>
  </FatalErrorBoundary>
)

export default App
