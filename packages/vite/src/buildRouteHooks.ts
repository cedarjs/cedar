import path from 'node:path'

import type { Plugin } from 'vite'
import { build as viteBuild } from 'vite'
import { gqlPlugin as gqlTagPlugin } from 'vite-plugin-graphql-tag'
import tsPathsMod from 'vite-tsconfig-paths'

import { findRouteHooksSrc } from '@cedarjs/internal/dist/files.js'
import type { Paths } from '@cedarjs/project-config'
import { getPaths } from '@cedarjs/project-config'

import { cedarApiImportGuardPlugin } from './plugins/vite-plugin-cedar-api-import-guard.js'
import { cedarAutoImportsPlugin } from './plugins/vite-plugin-cedar-auto-import.js'
import { cedarDirectoryNamedImportPlugin } from './plugins/vite-plugin-cedar-directory-named-import.js'
import { cedarjsResolveCedarStyleImportsPlugin } from './plugins/vite-plugin-cedarjs-resolve-cedar-style-imports.js'

// vite-tsconfig-paths is ESM-only. CJS builds double-wrap its default
// export: tsconfigPaths.default is the module object, and
// tsconfigPaths.default.default is the actual function. ESM gets the
// function directly. The `||` chain resolves correctly for both.
const tsconfigPaths =
  // @ts-expect-error – .default only exists at runtime in CJS double-wrap
  // interop
  tsPathsMod.default?.default || tsPathsMod.default || tsPathsMod

/**
 * Returns the path, relative to `web/dist/ssr/routeHooks` and with a `.js`
 * extension, that the built version of the given route hook source file is
 * written to. The layout mirrors `web/src`, so
 * `web/src/pages/HomePage/HomePage.routeHooks.ts` ends up at
 * `pages/HomePage/HomePage.routeHooks.js` and `web/src/App.routeHooks.ts` at
 * `App.routeHooks.js`.
 *
 * Used both by the build (to name the Rollup entries) and by the route
 * manifest (so the streaming handler can find the file at request time).
 */
export function getRouteHookDistPath(
  routeHookSrcPath: string,
  webSrc = getPaths().web.src,
) {
  return getRouteHookEntryName(routeHookSrcPath, webSrc) + '.js'
}

function getRouteHookEntryName(routeHookSrcPath: string, webSrc: string) {
  return path
    .relative(webSrc, routeHookSrcPath)
    .replace(/\.(js|ts|tsx|jsx)$/, '')
    .split(path.sep)
    .join('/')
}

/**
 * vite-plugin-graphql-tag only compiles `gql` tags that are bound to an
 * import from `graphql-tag`. Route hooks get that import from
 * cedarAutoImportsPlugin(), which runs as a `post` plugin. Running the gql
 * plugin as a `post` plugin placed after it means the import is in place by
 * the time it looks for `gql` tags.
 */
function postGqlTagPlugin(): Plugin {
  const plugin = gqlTagPlugin()

  // gqlPlugin() is typed as Vite's broad PluginOption union, but always
  // returns a single plugin object
  if (!plugin || Array.isArray(plugin) || plugin instanceof Promise) {
    throw new Error('vite-plugin-graphql-tag did not return a plugin object')
  }

  return { ...plugin, enforce: 'post' }
}

/**
 * Bundles every `web/src/** /*.routeHooks.{js,ts,tsx,jsx}` file into
 * `web/dist/ssr/routeHooks` as a node ESM module, one output file per route
 * hook. The streaming SSR handler `import()`s them at request time.
 */
export async function buildRouteHooks(
  verbose: boolean | undefined,
  rwPaths: Paths,
) {
  const allRouteHooks = findRouteHooksSrc()

  if (allRouteHooks.length === 0) {
    return
  }

  const input: Record<string, string> = {}
  for (const routeHook of allRouteHooks) {
    input[getRouteHookEntryName(routeHook, rwPaths.web.src)] = routeHook
  }

  await viteBuild({
    // Route hooks run in node, so the project's web/vite.config, which is set
    // up for browser and SSR builds of React code, doesn't apply. Only the
    // plugins listed below are used.
    configFile: false,
    root: rwPaths.web.base,
    // Route hooks are node modules, so the static assets in web/public
    // must not be copied next to them
    publicDir: false,
    envFile: false,
    logLevel: verbose ? 'info' : 'error',
    plugins: [
      // Turns `$api/` imports into an error in the client environment. It's a
      // no-op in this ssr-only build, but it has to sit in front of
      // tsconfigPaths() wherever that plugin is used, so it's kept here for
      // parity with the web build
      cedarApiImportGuardPlugin(),
      // Resolves the `paths` mapping in web/tsconfig.json, like `$api/*`
      tsconfigPaths(),
      // Resolves `src/` imports to the web side, `$api/` and `api/` imports to
      // the api side, and directory-named modules for those
      cedarjsResolveCedarStyleImportsPlugin(),
      // Resolves relative `./Foo` imports to `./Foo/index` or `./Foo/Foo`
      cedarDirectoryNamedImportPlugin(),
      // Auto-imports `gql` and `React`
      cedarAutoImportsPlugin(),
      // Compiles `gql` template literals into DocumentNode objects. Placed
      // after cedarAutoImportsPlugin(), see postGqlTagPlugin()
      postGqlTagPlugin(),
    ],
    build: {
      ssr: true,
      target: 'node24',
      minify: false,
      outDir: rwPaths.web.distRouteHooks,
      // The directory only ever holds route hook output, so clearing it keeps
      // chunks from earlier builds from piling up
      emptyOutDir: true,
      rollupOptions: {
        input,
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          // Modules shared between route hooks, like the api side's db.js
          chunkFileNames: 'chunks/[name]-[hash].js',
          exports: 'named',
        },
      },
    },
    // Node builtins and everything that resolves into node_modules stay as
    // imports for node to resolve at runtime. Only project files (the route
    // hook itself and whatever it imports from the web and api sides) are
    // bundled. Bare specifiers like `$api/` and `src/` are resolved by the
    // plugins above before Vite decides whether to externalize them
    ssr: {
      external: true,
    },
  })
}
