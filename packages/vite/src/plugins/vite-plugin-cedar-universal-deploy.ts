import { addEntry } from '@universal-deploy/store'
import type { Plugin } from 'vite'

// The virtual module ID for the Cedar API Universal Deploy entry.
const CEDAR_API_VIRTUAL_ENTRY_ID = 'virtual:cedar-api'

/**
 * Cedar Vite plugin for Universal Deploy integration (Phase 3 / Phase 5).
 *
 * Registers Cedar's API endpoint as a Universal Deploy server entry so that
 * UD-aware adapters can discover and bundle it. In Phase 5 this plugin will be
 * expanded to register individual route entries derived from Cedar's route
 * manifest.
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

        addEntry({
          id: CEDAR_API_VIRTUAL_ENTRY_ID,
          route: ['/api/**', '/graphql', '/graphql/**'],
          method: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
        })
      },
    },
    resolveId(id) {
      if (id === CEDAR_API_VIRTUAL_ENTRY_ID) {
        return id
      }

      return undefined
    },
    load(id) {
      if (id === CEDAR_API_VIRTUAL_ENTRY_ID) {
        // Phase 3 stub: returns a Fetchable that responds with 501 Not
        // Implemented. In Phase 5 this will be replaced with a proper Cedar
        // API dispatcher derived from the Cedar route manifest and Cedar server
        // entries.
        return `
export default {
  async fetch(_request) {
    return new Response(
      'Cedar API virtual entry: not yet implemented (Phase 5)',
      { status: 501 },
    )
  },
}
`
      }

      return undefined
    },
  }
}
