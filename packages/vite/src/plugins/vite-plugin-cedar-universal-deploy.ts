import { addEntry } from '@universal-deploy/store'
import type { Plugin } from 'vite'

// The virtual module ID for the Cedar API Universal Deploy entry.
const CEDAR_API_VIRTUAL_ENTRY_ID = 'virtual:cedar-api'

// The UD catch-all virtual module ID. @universal-deploy/node/serve imports
// this at runtime to get the single Fetchable that handles all routes.
const UD_CATCH_ALL_ID = 'virtual:ud:catch-all'

/**
 * Cedar Vite plugin for Universal Deploy integration (Phase 3 / Phase 5).
 *
 * Registers Cedar's API endpoint as a Universal Deploy server entry so that
 * UD-aware adapters can discover and bundle it. The virtual module uses
 * `buildCedarDispatcher` from `@cedarjs/api-server/udDispatcher` to build a
 * WinterTC-compatible Fetchable dispatcher at build time.
 *
 * Also resolves the UD catch-all virtual module (`virtual:ud:catch-all`) to
 * the Cedar API entry (`virtual:cedar-api`). UD adapters such as
 * `@universal-deploy/node` import `virtual:ud:catch-all` from their server
 * entry to obtain the single Fetchable that handles all routes. Cedar uses one
 * aggregate entry, so the catch-all is a simple re-export. In Phase 5 this
 * will be replaced with a generated multi-route catch-all derived from Cedar's
 * route manifest.
 *
 * Note: the `@universal-deploy/node` Vite plugin (`node()`) is intentionally
 * NOT included here. That plugin targets Vite's server build environment and
 * is meant to be added separately when Cedar adopts a Vite-based full-stack
 * build pipeline (Phase 4). Cedar's API side is currently built with
 * Babel/esbuild, not Vite.
 *
 * @see docs/implementation-plans/universal-deploy-integration-plan-refined.md
 */
export function cedarUniversalDeployPlugin(): Plugin {
  let entriesRegistered = false

  return {
    name: 'cedar:universal-deploy',
    config: {
      order: 'pre',
      handler() {
        if (entriesRegistered) {
          return
        }

        entriesRegistered = true

        // TODO(Phase 5): replace this single aggregate entry with per-route
        // addEntry() calls derived from Cedar's route manifest (Phase 2). The
        // hardcoded route list and single virtual:cedar-api entry are temporary
        // scaffolding. See the Phase 3 "Temporary scaffolding" section in
        // docs/implementation-plans/universal-deploy-integration-plan-refined.md
        addEntry({
          id: CEDAR_API_VIRTUAL_ENTRY_ID,
          route: ['/api/**', '/graphql', '/graphql/**'],
          method: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
        })
      },
    },
    resolveId(id) {
      if (id === CEDAR_API_VIRTUAL_ENTRY_ID || id === UD_CATCH_ALL_ID) {
        return id
      }

      return undefined
    },
    load(id) {
      if (id === UD_CATCH_ALL_ID) {
        // TODO(Phase 5): replace this simple re-export with a generated
        // multi-route dispatcher that imports each per-route entry and routes
        // via rou3 — matching what @universal-deploy/vite's catchAll() plugin
        // does for frameworks with multiple entries. This single re-export only
        // works because Phase 3 uses one aggregate virtual:cedar-api entry. See
        // the Phase 3 "Temporary scaffolding" section in
        // docs/implementation-plans/universal-deploy-integration-plan-refined.md
        return `export { default } from '${CEDAR_API_VIRTUAL_ENTRY_ID}'`
      }

      if (id === CEDAR_API_VIRTUAL_ENTRY_ID) {
        return `
          import { buildCedarDispatcher } from '@cedarjs/api-server/udDispatcher'
          const { fetchable } = await buildCedarDispatcher()
          export default fetchable
        `
      }

      return undefined
    },
  }
}
