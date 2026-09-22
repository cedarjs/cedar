import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { loadParsedScalarsCacheConfig } from '@cedarjs/internal/dist/generate/parsedScalars.js'
import { getParsedScalars, getPaths } from '@cedarjs/project-config'

const VIRTUAL_MODULE_ID = 'virtual:cedar-parsed-scalars'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

const APP_FILE_REGEXP = /web[\\/]src[\\/]App\.(ts|tsx|js|jsx)$/

// The setup file that `@cedarjs/testing` adds to every web test. The test
// providers in `@cedarjs/testing` render `CedarApolloProvider` without `App`
const VITEST_WEB_SETUP_FILE_REGEXP = /[\\/]vitest-web\.setup\.(ts|js)$/

/**
 * Gives `CedarApolloProvider` the cache config for the scalars in
 * `graphql.parsedScalars` in `cedar.toml`. Does nothing when no scalar is set
 * to be parsed.
 *
 * The config comes from the project's generated GraphQL schema, so it is built
 * into the virtual module `virtual:cedar-parsed-scalars` rather than into the
 * provider, which is a published package that Vite pre-bundles in dev. The
 * module puts the config on `globalThis.__CEDAR__PARSED_SCALARS`, where the
 * provider reads it when it creates the cache, and `App` and the web test
 * setup file import the module so that every entry point that renders the
 * provider has it. The module is a
 * dependency of the generated schema file, so a change to the schema reloads
 * the app.
 */
export function cedarParsedScalarsPlugin(): Plugin | undefined {
  // Also checks that the setting has values Cedar supports
  if (Object.keys(getParsedScalars()).length === 0) {
    return undefined
  }

  return {
    name: 'cedar-parsed-scalars',

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }

      return null
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null
      }

      this.addWatchFile(getPaths().generated.schema)

      const config = loadParsedScalarsCacheConfig()

      return `globalThis.__CEDAR__PARSED_SCALARS = ${JSON.stringify(config)}`
    },

    transform(code, id) {
      if (!APP_FILE_REGEXP.test(id) && !VITEST_WEB_SETUP_FILE_REGEXP.test(id)) {
        return null
      }

      return `import '${VIRTUAL_MODULE_ID}'\n${code}`
    },

    // `this.addWatchFile` in `load` only reruns the virtual module for a
    // change to a file it has already watched. The schema doesn't exist yet
    // on a clean `cedar dev` (the web server and `cedar-gen-watch` start
    // concurrently), so its first appearance is a 'create' event on a path
    // nothing has watched yet, and reaches here without an `addWatchFile`
    // call ever having registered it. Reload the virtual module for exactly
    // that file, on every event type, so the app picks up the first schema
    // once `cedar-gen-watch` writes it, the same way it already does for a
    // later edit.
    hotUpdate(options) {
      // Vite normalizes `options.file` to forward slashes before this hook
      // runs, but `getPaths().generated.schema` is built with `path.join`,
      // which keeps the OS-native separator, so an unnormalized comparison
      // never matches on Windows
      if (options.file !== normalizePath(getPaths().generated.schema)) {
        return
      }

      const moduleGraph = this.environment.moduleGraph
      const module = moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID)

      if (!module) {
        return
      }

      // The default HMR update only pushes an update to connected clients.
      // It doesn't clear the module's cached transform result, so a fresh
      // request for the module (a full page load, or a client that wasn't
      // connected yet) would still get the stale, pre-schema content
      moduleGraph.invalidateModule(module)

      return [module]
    },
  }
}
