import type { ReactNode } from 'react'

import { CedarApolloProvider} from '@cedarjs/web/apollo/CedarApolloProvider'

interface AppProps {
  children?: ReactNode
}

const App = ({ children }: AppProps) => {
  return (
    <CedarApolloProvider>{children}</CedarApolloProvider>
  )
}

export default App
