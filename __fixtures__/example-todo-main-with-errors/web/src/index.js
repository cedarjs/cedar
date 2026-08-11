import ReactDOM from 'react-dom'
import { CedarProvider, FatalErrorBoundary } from '@cedarjs/web'
import FatalErrorPage from 'src/pages/FatalErrorPage'

import Routes from './Routes'

import './index.css'

ReactDOM.render(
  <FatalErrorBoundary page={FatalErrorPage}>
    <CedarProvider>
      <Routes />
    </CedarProvider>
  </FatalErrorBoundary>,
  document.getElementById('redwood-app')
)
