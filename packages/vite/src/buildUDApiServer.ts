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
 * Loads the user's Vite config (`web/vite.config.ts`) so both provider
 * plugins (Netlify, Vercel, etc.) and Cedar's own UD plugin
 * (`cedarUniversalDeployPlugin`) run during the build.
 * Provider plugins produce their own deployment artifacts alongside Cedar's UD
 * output.
 * The user must include `cedarUniversalDeployPlugin()` in their Vite config to
 * register API routes.
 *
 * The emitted server entry is placed under `api/dist/ud/` so it does not
 * collide with the existing esbuild output under `api/dist/`.
 *
 * NOTE: The Vite "ssr" build target used here is a server-side module build
 * concern — it is NOT related to Cedar HTML SSR / streaming / RSC. "ssr"
 * simply means Vite produces a Node-compatible bundle rather than a browser
 * bundle.
 */
export async function buildUDApiServer({
  verbose = false,
  apiRootPath,
}: BuildUDApiServerOptions = {}) {
  const { build } = await import('vite')
  const { catchAll, devServer } = await import('@universal-deploy/vite')
  const { catchAllEntry, getAllEntries } =
    await import('@universal-deploy/store')

  const cedarPaths = getPaths()

  // The UD server entry is placed under api/dist/ud/ so it does not
  // collide with the existing esbuild output under api/dist/.
  const outDir = path.join(cedarPaths.api.dist, 'ud')

  // When --apiRootPath is passed via CLI, propagate it to the plugin via
  // an env var so the plugin can override whatever value was set in the
  // user's vite config. This avoids modifying the opaque plugin instance
  // after vite loads the user's configFile.
  if (apiRootPath !== undefined) {
    process.env.CEDAR_API_ROOT_PATH = apiRootPath
  }

  try {
    await build({
      // Load the user's Vite config so all plugins (Cedar's UD plugin,
      // provider plugins, etc.) run during the build.
      configFile: cedarPaths.web.viteConfig,
      logLevel: verbose ? 'info' : 'warn',

      plugins: [
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
                '\n  `api/src/functions/` and that your vite config includes',
                '\n  `cedarUniversalDeployPlugin()`.\n',
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
  } finally {
    if (apiRootPath !== undefined) {
      delete process.env.CEDAR_API_ROOT_PATH
    }
  }
}
