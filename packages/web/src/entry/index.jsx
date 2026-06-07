import { hydrateRoot, createRoot } from 'react-dom/client'

import App from '~redwood-app-root'
import Routes from '~redwood-app-routes'
/**
 * When `#cedar-app` or `#redwood-app` isn't empty then it's very likely that
 * you're using prerendering. So React attaches event listeners to the existing
 * markup rather than replacing it.
 * https://react.dev/reference/react-dom/client/hydrateRoot
 */
const cedarAppElement =
  document.getElementById('cedar-app') ?? document.getElementById('redwood-app')

if (!cedarAppElement) {
  throw new Error(
    'Could not find an element with ID "cedar-app" or "redwood-app". Please ' +
      'ensure one exists in your `web/index.html` file.',
  )
}

if (cedarAppElement.children?.length > 0) {
  hydrateRoot(
    cedarAppElement,
    <App>
      <Routes />
    </App>,
  )
} else {
  const root = createRoot(cedarAppElement)
  root.render(
    <App>
      <Routes />
    </App>,
  )
}
