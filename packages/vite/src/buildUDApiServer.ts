import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export interface BuildUDApiServerOptions {
  verbose?: boolean
}

/**
 * Builds the API server Universal Deploy server entry using Vite.
 *
 * Runs a Vite SSR build using the **user's own vite config**
 * (`web/vite.config.ts`), so whatever deployment plugins the user has added
 * (Netlify, Vercel, Cloudflare, Node, etc.) are active during the build.
 *
 * The user's config is expected to include:
 *   - `cedarUniversalDeployPlugin()` — registers per-route API entries with
 *     `@universal-deploy/store`
 *   - `universalDeploy()` from `@universal-deploy/vite` — provides
 *     `catchAll()`, `devServer()`, and auto-detection of the deployment
 *     target. When a specific deployment Vite plugin (e.g. `@netlify/
 *     vite-plugin`) is present, `universalDeploy()` detects it and adapts;
 *     otherwise it defaults to `@universal-deploy/node`.
 *   - Any adapter plugin the user's deployment target requires (e.g.
 *     `@netlify/vite-plugin` + `@universal-deploy/netlify/vite` for Netlify)
 *
 * Because the build uses the user's config, `cedar build --ud` is
 * **adapter-agnostic** — Cedar does not know or care which deployment target
 * the user has configured.
 *
 * The emitted server entry is placed under `api/dist/ud/` so it does not
 * collide with the existing esbuild output under `api/dist/`.
 *
 * NOTE: The Vite "ssr" build target used here is a server-side module build
 * concern — it is NOT related to Cedar HTML SSR or RSC. "ssr" simply means
 * Vite produces a Node-compatible bundle rather than a browser bundle.
 */
export const buildUDApiServer = async ({
  verbose = false,
}: BuildUDApiServerOptions = {}) => {
  const { build } = await import('vite')

  const rwPaths = getPaths()

  // The UD server entry is placed under api/dist/ud/ so it does not
  // collide with the existing esbuild output under api/dist/.
  const outDir = path.join(rwPaths.api.dist, 'ud')

  await build({
    // Use the user's vite config so their deployment plugins (Netlify, etc.)
    // are active. No hardcoded plugins.
    configFile: rwPaths.web.viteConfig,
    logLevel: verbose ? 'info' : 'warn',

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
