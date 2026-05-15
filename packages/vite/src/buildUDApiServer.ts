import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export interface BuildUDApiServerOptions {
  verbose?: boolean
  apiRootPath?: string
}

/**
 * Builds the API server Universal Deploy server entry using Vite.
 *
 * Runs a Vite SSR build that produces a pure WinterTC-compatible Fetchable
 * (`export default { fetch }`) at `api/dist/ud/index.js`. The output
 * contains NO HTTP server startup code — the Fetchable is wrapped by
 * `cedar serve` at runtime.
 *
 * Loads the user's Vite config (`web/vite.config.ts`) so provider plugins
 * (Netlify, Vercel, etc.) can produce their own deployment artifacts
 * alongside Cedar's canonical local-serve artifact. Cedar's own UD plugins
 * (`cedarUniversalDeployPlugin`, `catchAll`, `devServer`) are injected
 * independently and are not affected by user config.
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
  apiRootPath,
}: BuildUDApiServerOptions = {}) => {
  const { build } = await import('vite')
  const { cedarUniversalDeployPlugin } =
    await import('./plugins/vite-plugin-cedar-universal-deploy.js')
  const { catchAll, devServer } = await import('@universal-deploy/vite')
  const { catchAllEntry, getAllEntries } =
    await import('@universal-deploy/store')

  const cedarPaths = getPaths()

  // The UD server entry is placed under api/dist/ud/ so it does not
  // collide with the existing esbuild output under api/dist/.
  const outDir = path.join(cedarPaths.api.dist, 'ud')

  await build({
    // Load the user's Vite config so provider plugins can run alongside
    // Cedar's canonical UD build.
    configFile: cedarPaths.web.viteConfig,
    logLevel: verbose ? 'info' : 'warn',

    plugins: [
      // Registers per-route API entries with @universal-deploy/store.
      // The apiRootPath is baked into the generated route patterns by
      // cedarUniversalDeployPlugin's normaliseApiPrefix helper.
      cedarUniversalDeployPlugin({ apiRootPath }),

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

      // Warn if no Cedar API routes were registered — likely means the
      // user's vite config is missing cedarUniversalDeployPlugin or there
      // are no API functions to serve.
      {
        name: 'cedar-ud-verify-routes',
        configResolved() {
          const entries = getAllEntries()
          if (entries.length === 0) {
            console.warn(
              '\n  Warning: No Universal Deploy API routes were registered.',
              '\n  The built server entry will be an empty router (404 for all',
              '\n  requests). Check that you have API functions under',
              '\n  `api/src/functions/`.\n',
            )
          }
        },
      },
    ],

    // Legacy ssr flag approach. The explicit rollupOptions.input prevents the
    // "index.html as SSR entry" error. Vite will also build a 'client'
    // environment from the user's config file (wasteful but harmless), and
    // the 'ssr' environment produces our canonical Fetchable artifact at
    // api/dist/ud/index.js.
    build: {
      ssr: true,
      outDir,
      rollupOptions: {
        input: catchAllEntry,
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  })
}
