import type { Plugin } from 'vite'

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
  }
}
