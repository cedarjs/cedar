import type { ReactNode } from 'react'

import { FatalErrorBoundary, CedarProvider } from '@cedarjs/web'
import { CedarApolloProvider } from '@cedarjs/web/apollo/CedarApolloProvider'

import FatalErrorPage from 'src/pages/FatalErrorPage'

import { AuthProvider, useAuth } from './auth.js'

import './index.css'
import './scaffold.css'

interface AppProps {
  children?: ReactNode
}

const App = ({ children }: AppProps) => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <CedarProvider titleTemplate="%PageTitle | %AppTitle">
      <AuthProvider>
        <CedarApolloProvider useAuth={useAuth}>{children}</CedarApolloProvider>
      </AuthProvider>
    </CedarProvider>
  </FatalErrorBoundary>
)

export default App
