import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export interface BuildUDApiServerOptions {
  verbose?: boolean
  apiRootPath?: string
}

/**
 * Builds the API server Universal Deploy entry using Vite.
 *
 * Runs a Vite server build that:
 *   1. Installs `cedarUniversalDeployPlugin()` to register per-route API
 *      entries (GraphQL, auth, functions) with UD's store.
 *   2. Installs `universalDeploy()` from `@universal-deploy/vite` which
 *      provides `catchAll()` (rou3-based route dispatch), `devServer()`, and
 *      auto-detection of deployment targets (Node by default, or Netlify/
 *      Vercel/Cloudflare if the user has added the corresponding Vite plugin).
 *
 * The emitted entry can be launched directly:  node api/dist/ud/index.js
 * That is what `cedar serve api` does.
 *
 * NOTE: The Vite "ssr" build target used here is a server-side module build
 * concern — it is NOT related to Cedar HTML SSR or RSC. "ssr" simply means
 * Vite produces a Node-compatible bundle rather than a browser bundle.
 */
export const buildUDApiServer = async ({
  verbose = false,
  apiRootPath,
}: BuildUDApiServerOptions = {}) => {
  // Dynamic imports so that vite and the UD plugins are only loaded when
  // this function is actually called (keeps cold-start cost of importing
  // @cedarjs/vite low for callers that only need the web build path).
  const { build } = await import('vite')
  const { cedarUniversalDeployPlugin } =
    await import('./plugins/vite-plugin-cedar-universal-deploy.js')
  const { default: universalDeploy } = await import('@universal-deploy/vite')

  const rwPaths = getPaths()

  // The UD server entry is placed under api/dist/ud/ so it does not
  // collide with the existing esbuild output under api/dist/.
  const outDir = path.join(rwPaths.api.dist, 'ud')

  await build({
    logLevel: verbose ? 'info' : 'warn',

    plugins: [
      // Registers per-route API entries with @universal-deploy/store.
      cedarUniversalDeployPlugin({ apiRootPath }),

      // Includes catchAll(), devServer(), and auto-detection of
      // deployment targets. Enables @universal-deploy/node by default
      // when no other target (Netlify, Vercel, Cloudflare) is detected
      // in the user's Vite config.
      universalDeploy(),
    ],

    // The ssr environment is the Vite mechanism for server-side builds.
    // Reminder: "ssr" here means "server-side module execution", NOT
    // Cedar HTML SSR / streaming / RSC.
    environments: {
      ssr: {
        build: {
          outDir,
        },
      },
    },

    build: {
      // This is a server (Node) build, not a browser build.
      ssr: true,
    },
  })
}
