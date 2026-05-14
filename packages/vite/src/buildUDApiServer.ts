import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export interface BuildUDApiServerOptions {
  verbose?: boolean
}

/**
 * Builds the API server Universal Deploy server entry using Vite.
 *
 * Runs a Vite SSR build that produces a pure WinterTC-compatible Fetchable
 * (`export default { fetch }`) at `api/dist/ud/index.mjs`. The output
 * contains NO HTTP server startup code — the Fetchable is wrapped by
 * `cedar serve` at runtime.
 *
 * Deployment-specific plugins (Netlify, Vercel, etc.) are independent;
 * they must be added to the user's vite config and run as a separate
 * `vite build` (or via the provider's own CLI).
 *
 * The emitted server entry is placed under `api/dist/ud/` so it does not
 * collide with the existing esbuild output under `api/dist/`.
 *
 * NOTE: The Vite "ssr" build target used here is a server-side module build
 * concern — it is NOT related to Cedar HTML SSR / streaming / RSC. "ssr"
 * simply means Vite produces a Node-compatible bundle rather than a browser
 * bundle.
 */
export const buildUDApiServer = async ({
  verbose = false,
}: BuildUDApiServerOptions = {}) => {
  const { build } = await import('vite')
  const { cedarUniversalDeployPlugin } =
    await import('./plugins/vite-plugin-cedar-universal-deploy.js')
  const { catchAll, devServer } = await import('@universal-deploy/vite')

  const rwPaths = getPaths()

  // The UD server entry is placed under api/dist/ud/ so it does not
  // collide with the existing esbuild output under api/dist/.
  const outDir = path.join(rwPaths.api.dist, 'ud')

  await build({
    logLevel: verbose ? 'info' : 'warn',

    plugins: [
      // Registers per-route API entries with @universal-deploy/store.
      cedarUniversalDeployPlugin(),

      // catchAll() generates the rou3-based route dispatcher
      // (virtual:ud:catch-all). devServer() provides Vite dev support for
      // cedar dev --ud.
      //
      // NOTE: We intentionally do NOT use universalDeploy() here — that
      // plugin auto-detects deployment targets and would embed the Node
      // HTTP server startup code into the output. Our plugin list is
      // adapter-free: the output is a pure Fetchable export, and cedar
      // serve wraps it in srvx at runtime.
      catchAll(),
      devServer(),
    ],

    build: {
      // This is a server (Node) build, not a browser build.
      ssr: true,
      outDir,

      // Explicitly set the input to the UD catch-all dispatcher so Vite
      // does not auto-detect an index.html file as the SSR entry point.
      rollupOptions: {
        input: 'virtual:ud:catch-all',
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  })
}
