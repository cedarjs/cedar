- feat(web): Add useNewVersionAvailable() hook

Adds a `useNewVersionAvailable()` hook to `@cedarjs/web` that returns `true`
once the server is serving a newer build of the app than the one running in the
current tab, so apps can show a "new version available, please reload" banner.

The running build is identified by the content-hashed `<script type="module">`
files in the current document. Every 60 seconds (configurable with
`intervalMs`), when the tab becomes visible again and when the browser comes
back online, the hook fetches the URL the tab was loaded from with
`cache: 'no-store'` and `credentials: 'omit'` and compares the module scripts in
the response with the running ones. Leaving out cookies means hosts with skew
protection, like Netlify, always answer with the latest deploy. All components
using the hook with the same interval share one polling loop, and polling stops
once a new version is found. The hook is inert during server rendering, in
development, and when the page has no module scripts.

```jsx
import { useNewVersionAvailable } from '@cedarjs/web'

const NewVersionBanner = () => {
  const newVersionAvailable = useNewVersionAvailable()

  if (!newVersionAvailable) {
    return null
  }

  return (
    <div role="status">
      A new version of the app is available.
      <button onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
```
