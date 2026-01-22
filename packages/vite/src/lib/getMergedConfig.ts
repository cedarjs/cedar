import path from 'node:path'

import type { InputOption } from 'rollup'
import { mergeConfig } from 'vite'
import type { ConfigEnv, ViteUserConfig } from 'vitest/config'

import type { Config, Paths } from '@cedarjs/project-config'
import {
  getConfig,
  getEnvVarDefinitions,
  getPaths,
} from '@cedarjs/project-config'

/**
 * This function will merge in the default Cedar Vite config passed into the
 * build function (or in Vite.config.xxx)
 *
 * Note that returning plugins in this function will have no effect on the
 * build
 */
export function getMergedConfig(cedarConfig: Config, cedarPaths: Paths) {
  return (userConfig: ViteUserConfig, env: ConfigEnv): ViteUserConfig => {
    let apiHost = process.env.REDWOOD_API_HOST
    apiHost ??= cedarConfig.api.host
    apiHost ??= process.env.NODE_ENV === 'production' ? '0.0.0.0' : '[::]'

    const streamingSsrEnabled = cedarConfig.experimental.streamingSsr?.enabled
    // @MARK: note that most RSC settings sit in their individual build functions
    const rscEnabled = cedarConfig.experimental.rsc?.enabled

    let apiPort
    if (process.env.REDWOOD_API_PORT) {
      apiPort = parseInt(process.env.REDWOOD_API_PORT)
    } else {
      apiPort = cedarConfig.api.port
    }

    const defaultCedarViteConfig: ViteUserConfig = {
      root: cedarPaths.web.src,
      // @MARK: when we have these aliases, the warnings from the FE server go
      // away BUT, if you have imports like this:
      // ```
      // import RandomNumberServerCell from
      //   'src/components/RandomNumberServerCell/RandomNumberServerCell'
      // ```
      // they start failing (can't have the double
      // `/RandomNumberServerCell/RandomNumberServerCell` at the end)
      //
      // resolve: {
      //   alias: [
      //     {
      //       find: 'src',
      //       replacement: cedarPaths.web.src,
      //     },
      //   ],
      // },
      envPrefix: 'REDWOOD_ENV_',
      publicDir: path.join(cedarPaths.web.base, 'public'),
      define: getEnvVarDefinitions(),
      css: {
        // @NOTE config path is relative to where vite.config.js is if you use
        // a relative path
        postcss: cedarPaths.web.config,
      },
      server: {
        open: cedarConfig.browser.open,
        port: cedarConfig.web.port,
        host: true, // Listen to all hosts
        proxy: {
          [cedarConfig.web.apiUrl]: {
            target: `http://${apiHost}:${apiPort}`,
            changeOrigin: false,
            // Remove the `.redwood/functions` part, but leave the `/graphql`
            rewrite: (path) => path.replace(cedarConfig.web.apiUrl, ''),
            configure: (proxy) => {
              // @MARK: this is a hack to prevent showing confusing proxy
              // errors on startup because Vite launches so much faster than
              // the API server.
              let waitingForApiServer = true

              // Wait for 2.5s, then restore regular proxy error logging
              setTimeout(() => {
                waitingForApiServer = false
              }, 2500)

              proxy.on('error', (err, req, res) => {
                const isWaiting =
                  waitingForApiServer && err.message.includes('ECONNREFUSED')

                if (!isWaiting) {
                  console.error(err)
                }

                // This heuristic isn't perfect. It's written to handle dbAuth.
                // But it's very unlikely the user would have code that does
                // this exact request without it being an auth token request.
                // We need this special handling because we don't want the error
                // message below to be used as the auth token.
                const isAuthTokenRequest =
                  isWaiting && req.url === '/auth?method=getToken'

                const waitingMessage =
                  '⌛ API Server launching, please refresh your page...'
                const genericMessage =
                  'The Cedar API server is not available or is currently ' +
                  'reloading. Please refresh.'

                const responseBody = {
                  errors: [
                    { message: isWaiting ? waitingMessage : genericMessage },
                  ],
                }

                // Use 203 to indicate that the response was modified by a proxy
                res.writeHead(203, {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-cache',
                })

                if (!isAuthTokenRequest) {
                  res.write(JSON.stringify(responseBody))
                }

                res.end()
              })
            },
          },
        },
      },
      build: {
        // TODO (RSC): Remove `minify: false` when we don't need to debug as often
        minify: false,
        // NOTE this gets overridden when build gets called anyway!
        outDir:
          streamingSsrEnabled || rscEnabled
            ? cedarPaths.web.distBrowser
            : cedarPaths.web.dist,
        emptyOutDir: true,
        manifest: !env.isSsrBuild ? 'client-build-manifest.json' : undefined,
        // Note that sourcemap can be boolean or 'inline'
        sourcemap: !env.isSsrBuild && cedarConfig.web.sourceMap,
        rollupOptions: {
          input: getRollupInput(!!env.isSsrBuild),
        },
      },
      // @MARK: do not set buildSsrCjsExternalHeuristics here
      // because rsc builds want false, client and server build wants true
      optimizeDeps: {
        esbuildOptions: {
          // @MARK this is because JS projects in Cedar don't have .jsx
          // extensions
          loader: {
            '.js': 'jsx',
          },
          // Node.js global to browser globalThis
          // @MARK unsure why we need this, but required for DevFatalErrorPage
          // at least
          define: {
            global: 'globalThis',
          },
        },
      },
      ssr: {
        // `@cedarjs/testing` is not externalized in order to support
        // `import.meta.glob`, which we use in one of the files in the package
        noExternal: env.mode === 'test' ? ['@cedarjs/testing'] : [],
      },
      test: {
        globals: false,
        environment: 'jsdom',
      },
    }

    return mergeConfig(defaultCedarViteConfig, userConfig)
  }
}

/**
 * This function configures how vite (actually Rollup) will bundle.
 *
 * By default, the entry point is the index.html file - even if you don't
 * specify it in RollupOptions
 *
 * With streaming SSR, our entrypoint is different - either entry.client.tsx or
 * entry.server.tsx and the html file is not used at all, because it is defined
 * in Document.tsx
 *
 * @param ssr Whether to return the SSR inputs or not
 * @returns Rollup input Options
 */
function getRollupInput(ssr: boolean): InputOption | undefined {
  const cedarConfig = getConfig()
  const cedarPaths = getPaths()

  if (!cedarPaths.web.entryClient) {
    throw new Error('entryClient not defined')
  }

  const streamingEnabled = cedarConfig.experimental?.streamingSsr?.enabled
  const rscEnabled = cedarConfig.experimental?.rsc?.enabled

  // @NOTE once streaming ssr is out of experimental, this will become the
  // default
  if (streamingEnabled) {
    if (ssr) {
      if (!cedarPaths.web.entryServer) {
        throw new Error('entryServer not defined')
      }

      if (rscEnabled) {
        return {
          Document: cedarPaths.web.document,
          'entry.server': cedarPaths.web.entryServer,
        }
      }

      return {
        // NOTE: We're building the server entry *without* the react-server
        // condition when we include it here. This works when only SSR is
        // enabled, but not when RSC + SSR are both enabled
        // For RSC we have this configured in rscBuildForServer.ts to get a
        // build with the proper resolution conditions set.
        'entry.server': cedarPaths.web.entryServer,
        // We need the document for React's fallback
        Document: cedarPaths.web.document,
      }
    }

    return cedarPaths.web.entryClient
  }

  return cedarPaths.web.html
}
