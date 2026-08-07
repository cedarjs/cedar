import { hydrateRoot, createRoot } from 'react-dom/client'

import App from './App'
import Routes from './Routes'

/**
 * When `#cedar-app` isn't empty then it's very likely that you're using
 * prerendering. So React attaches event listeners to the existing markup
 * rather than replacing it.
 * https://react.dev/reference/react-dom/client/hydrateRoot
 */
const cedarAppElement = document.getElementById('cedar-app')

if (!cedarAppElement) {
  throw new Error(
    'Could not find an element with ID "cedar-app". Please ensure it exists ' +
      'in your `web/index.html` file.'
  )
}

if (cedarAppElement.children?.length > 0) {
  hydrateRoot(
    cedarAppElement,
    <App>
      <Routes />
    </App>
  )
} else {
  const root = createRoot(cedarAppElement)
  root.render(
    <App>
      <Routes />
    </App>
  )
}
