import React from 'react'
import { ApolloProvider } from '@apollo/client'
import ApolloProviderFromCedar from '@cedarjs/web/apollo'

import { client } from 'src/lib/apollo'
import { Routes } from './Routes.tsx'

const App = () => {
  return (
    <div className="app">
      <ApolloProviderFromCedar client={client}>
        <Routes />
      </ApolloProviderFromCedar>
    </div>
  )
}

export default App
