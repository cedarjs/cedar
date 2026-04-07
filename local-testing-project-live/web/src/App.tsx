import type { ReactNode } from 'react'

import { configureGqlorm } from '@cedarjs/gqlorm/setup'
import { FatalErrorBoundary, RedwoodProvider } from '@cedarjs/web'
import { RedwoodApolloProvider } from '@cedarjs/web/apollo'

import FatalErrorPage from 'src/pages/FatalErrorPage'

import { AuthProvider, useAuth } from './auth.js'

import './index.css'
import './scaffold.css'

// Configure gqlorm with the scalar fields for each Prisma model.
// Sensitive fields (hashedPassword, salt, resetToken, resetTokenExpiresAt)
// and relation fields (author, posts) are intentionally excluded.
configureGqlorm({
  schema: {
    post: ['id', 'title', 'body', 'authorId', 'createdAt'],
    user: ['id', 'email', 'fullName', 'roles'],
    contact: ['id', 'name', 'email', 'message', 'createdAt'],
  },
})

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
