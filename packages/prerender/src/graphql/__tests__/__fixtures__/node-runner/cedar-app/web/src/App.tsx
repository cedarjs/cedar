import type { ReactNode } from 'react'

import { RedwoodApolloProvider} from '@cedarjs/web/apollo'

interface AppProps {
  children?: ReactNode
}

const App = ({ children }: AppProps) => {
  return (
    <RedwoodApolloProvider>{children}</RedwoodApolloProvider>
  )
}

export default App
