/// <reference types="vite/client" />

// We're building this file with esbuild, which doesn't understand the vite-
// specific `import.meta.glob` feature. So it'll just leave it as is, which is
// actually exactly what we want. We can't evaluate the glob import when
// building the framework, because at that time we have no idea what user
// project this will be used in or what routes it will have. So instead I tell
// vite to process this file when building the user's project. I do that by
// including @cedarjs/testing in `noExternal` in the default vite config (see
// lib/getMergedConfig.ts in the vite package)

// We want to find the user's Routes file in web/src/Routes.{tsx,jsx}
// When running tests from the root of the user's project, vite will see the
// path as `/src/Routes.tsx`. When running the tests from the web/ directory,
// vite will see the path as `/Routes.tsx`
const defaultExports = import.meta.glob(
  ['/src/Routes.{tsx,jsx}', '/Routes.{tsx,jsx}'],
  {
    import: 'default',
    eager: true,
  },
)
const routesFileName = Object.keys(defaultExports)[0]

if (!routesFileName) {
  throw new Error('@cedarjs/testing: No routes found')
}

const routesFunction = defaultExports[routesFileName]

if (typeof routesFunction !== 'function') {
  throw new Error(
    '@cedarjs/testing: Routes file does not export a React component',
  )
}

/**
 * All the routes the user has defined
 *
 * We render this in the `<MockProviders>` component to populate the `routes`
 * import from `@cedarjs/router` to make sure code like
 * `<Link to={routes.home()}>Home</Link>` works in tests
 *
 * The final piece to this puzzle is to realize that the user's Routes file
 * imports `@cedarjs/router`, which we replace to import from '@cedarjs/testing'
 * instead using a vite plugin that we only run for vitest and storybook
 */
export const UserRoutes = routesFunction as React.FC
