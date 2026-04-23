import { addEntry } from '@universal-deploy/store'
import { serve } from 'srvx'
import type { Server } from 'srvx'

import type { CedarDispatcherOptions } from './udDispatcher.js'
import { buildCedarDispatcher } from './udDispatcher.js'

export interface CreateUDServerOptions extends CedarDispatcherOptions {
  port?: number
  host?: string
}

// TODO Phase 4 — remove this function. It is temporary scaffolding that
// stands in for `@universal-deploy/node` while Cedar's API is built with
// Babel/esbuild rather than Vite. Once Phase 4 moves the API to a Vite build
// and wires in `node()` from `@universal-deploy/node/vite`, `cedar serve`
// will run the Vite-built server entry directly and this function has no
// remaining purpose. See the Phase 3 "Temporary scaffolding" section in
// docs/implementation-plans/universal-deploy-integration-plan-refined.md
/**
 * Creates a WinterTC-compatible HTTP server using srvx that serves Cedar API
 * functions discovered in `api/dist/functions/`. Function discovery and
 * routing are delegated to buildCedarDispatcher. Each discovered function is
 * also registered with the @universal-deploy/store via addEntry() for UD
 * tooling introspection.
 */
export async function createUDServer(
  options?: CreateUDServerOptions,
): Promise<Server> {
  const port = options?.port ?? 8911
  const host = options?.host

  const { fetchable, registrations } = await buildCedarDispatcher({
    apiRootPath: options?.apiRootPath,
    discoverFunctionsGlob: options?.discoverFunctionsGlob,
  })

  for (const registration of registrations) {
    addEntry(registration)
  }

  const server = serve({
    port,
    hostname: host,
    fetch(request: Request): Promise<Response> {
      return Promise.resolve(fetchable.fetch(request))
    },
  })

  await server.ready()

  return server
}
