import type { ReactNode } from 'react'

import { FatalErrorBoundary, RedwoodProvider } from '@cedarjs/web'
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
    <RedwoodProvider titleTemplate="%PageTitle | %AppTitle">
      <AuthProvider>
        <CedarApolloProvider useAuth={useAuth}>{children}</CedarApolloProvider>
      </AuthProvider>
    </RedwoodProvider>
  </FatalErrorBoundary>
)

export default App
