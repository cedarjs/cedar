import { createRoot } from 'react-dom/client'

import App from './App'
import Routes from './Routes'

const redwoodAppElement = document.getElementById('redwood-app')

if (!redwoodAppElement) {
  throw new Error("Could not find an element with ID 'redwood-app'")
}

const root = createRoot(redwoodAppElement)
root.render(
  <App>
    <Routes />
  </App>,
)
