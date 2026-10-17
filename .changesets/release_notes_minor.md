## Keeping open tabs working across deploys

A browser tab opened before a deploy keeps running the build it loaded. Three
features in this release work together to keep those tabs working:

- **Reload on missing chunks.** When a lazy-loaded page chunk fails to load,
  `@cedarjs/web` reloads the page so the user gets the latest deploy and lands
  on the page they navigated to. This works on any host and needs no changes to
  your app. If your app handles Vite's `vite:preloadError` event itself,
  register your listener with `{ capture: true }` and call
  `event.preventDefault()`, and Cedar leaves the event alone. See
  [Recovering from a stale build](https://cedarjs.com/docs/deploy/introduction#recovering-from-a-stale-build).
- **`useNewVersionAvailable()`.** This new hook in `@cedarjs/web` returns `true`
  once the server is serving a newer build than the one running in the tab, so
  you can show a "new version available" prompt. See
  [Detecting new deploys](https://cedarjs.com/docs/deploy/introduction#detecting-new-deploys).
- **Netlify skew protection.** `yarn cedar setup deploy netlify --ud` adds
  `cedarNetlifySkewProtectionPlugin()` from `@cedarjs/vite`. An open tab keeps
  loading assets and calling the API of the deploy it started on, and page
  loads always get the latest deploy. Run the setup command again to add the
  plugin to an existing app. See
  [Skew protection](https://cedarjs.com/docs/deploy/universal-deploy#skew-protection).

## Type your layouts for Cedar v8

`@cedarjs/router` exports a `WrapperProps` interface for layouts and other
components used in `<Set wrap>`:

```tsx
import type { WrapperProps } from '@cedarjs/router'

const MainLayout = ({ children }: WrapperProps) => {
  return <main>{children}</main>
}
```

In Cedar v8, every component in `wrap` gets exactly `WrapperProps`. Layouts
typed with it now work unchanged after upgrading.

## Faster API builds with a generated Prisma client

When a Prisma client generator writes its output into `api/src` (for example
`output = "../src/generated/prisma"`), Cedar skips its API source transforms
for the generated files and only rewrites their import paths. For a 60-model
schema, the default `cedar build` API build goes from about 21 seconds to about
1 second.

## Storybook only listens on localhost

Storybook is upgraded to 8.6.19 for two security fixes. Its dev server listens
on `127.0.0.1` only, so `yarn cedar storybook` can't be reached from other
devices on your network or from outside a container.

## Major dependency updates for security fixes

`@cedarjs/mailer-handler-nodemailer` uses nodemailer 10, and
`@cedarjs/graphql-server` and `@cedarjs/realtime` use version 12 of
`@graphql-tools/utils`. Both are updated for security fixes. Your app's own
copies of these packages, if it has any, aren't affected.
