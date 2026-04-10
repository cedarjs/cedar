import type { ReactNode } from 'react'

import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import { FatalErrorBoundary, RedwoodProvider } from '@cedarjs/web'
import { RedwoodApolloProvider } from '@cedarjs/web/apollo'

import FatalErrorPage from 'src/pages/FatalErrorPage'

import schema from '../../.cedar/gqlorm-schema.json' with { type: 'json' }

import { AuthProvider, useAuth } from './auth.js'

import './index.css'
import './scaffold.css'

configureGqlorm({ schema })

interface AppProps {
  children?: ReactNode
}

const App = ({ children }: AppProps) => (
  <FatalErrorBoundary page={FatalErrorPage}>
    <RedwoodProvider titleTemplate="%PageTitle | %AppTitle">
      <AuthProvider>
        <RedwoodApolloProvider useAuth={useAuth}>
          {children}
        </RedwoodApolloProvider>
      </AuthProvider>
    </RedwoodProvider>
  </FatalErrorBoundary>
)

export default App
