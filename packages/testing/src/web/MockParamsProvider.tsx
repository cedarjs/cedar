import React from 'react'

import { useLocation, ParamsContext, parseSearch } from '@cedarjs/router'

import { mockedRouteParamsMeta } from './mockRequests.js'

interface Props {
  children?: React.ReactNode
}

export const MockParamsProvider: React.FC<Props> = ({ children }) => {
  const location = useLocation()
  const searchParams = parseSearch(location.search)

  // Path params (set via `mockRouteParams`) take precedence over search
  // params, the same order `Router` combines them in when actually matching
  // a route: `{ ...searchParams, ...pathParams }`.
  return (
    <ParamsContext.Provider
      value={{
        params: { ...searchParams, ...mockedRouteParamsMeta.params },
      }}
    >
      {children}
    </ParamsContext.Provider>
  )
}
