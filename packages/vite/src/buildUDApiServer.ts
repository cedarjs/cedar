import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export interface BuildUDApiServerOptions {
  verbose?: boolean
  apiRootPath?: string
}

/**
 * Builds the API server Universal Deploy Node entry using Vite.
 *
 * Runs a Vite server build that:
 *   1. Installs `cedarUniversalDeployPlugin()` to register `virtual:cedar-api`
 *      and resolve `virtual:ud:catch-all` → Cedar's aggregate fetch dispatcher
 *   2. Installs `node()` from `@universal-deploy/node/vite` to emit a
 *      self-contained Node server entry at `api/dist/ud/index.js`
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
  const { node } = await import('@universal-deploy/node/vite')

  const rwPaths = getPaths()

  // The UD Node server entry is placed under api/dist/ud/ so it does not
  // collide with the existing esbuild output under api/dist/.
  const outDir = path.join(rwPaths.api.dist, 'ud')

  await build({
    // No configFile — we configure everything inline so this build is
    // self-contained and does not require a vite.config.ts in api/.
    configFile: false,
    envFile: false,
    logLevel: verbose ? 'info' : 'warn',

    plugins: [
      // Registers virtual:cedar-api with @universal-deploy/store and resolves
      // virtual:ud:catch-all → virtual:cedar-api → Cedar's aggregate fetchable.
      cedarUniversalDeployPlugin({ apiRootPath }),

      // Emits a self-contained Node server entry (api/dist/ud/index.js) that
      // imports virtual:ud:catch-all and starts an srvx HTTP server.
      // This is a Vite server-build concern, not Cedar HTML SSR.
      ...node(),
    ],

    // The ssr environment is the Vite mechanism for server-side builds.
    // Reminder: "ssr" here means "server-side module execution", NOT
    // Cedar HTML SSR / streaming / RSC.
    environments: {
      ssr: {
        build: {
          outDir,
          // Ensure @universal-deploy/node is bundled into the output so the
          // emitted entry is self-contained.
          rollupOptions: {
            output: {
              // Produce a single-file entry where possible; srvx chunks are
              // split by the node() plugin automatically.
              entryFileNames: '[name].js',
            },
          },
        },
        resolve: {
          // Do not externalise @universal-deploy/node — the node() plugin
          // requires it to be bundled into the server entry.
          noExternal: ['@universal-deploy/node'],
        },
      },
    },

    build: {
      // Write the server entry to api/dist/ud/
      outDir,
      // This is a server (Node) build, not a browser build.
      ssr: true,
    },
  })
}
