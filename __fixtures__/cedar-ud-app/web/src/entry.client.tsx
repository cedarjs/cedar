import { createRoot } from 'react-dom/client'

import App from './App'
import Routes from './Routes'

const cedarAppElement = document.getElementById('cedar-app')

if (!cedarAppElement) {
  throw new Error("Could not find an element with ID 'cedar-app'")
}

const root = createRoot(cedarAppElement)
root.render(
  <App>
    <Routes />
  </App>,
)
