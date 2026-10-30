import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, afterEach, beforeAll } from 'vitest'

import { getPaths } from '@cedarjs/project-config'

import { findCellMocks } from '../findCellMocks.js'
import {
  closeServer,
  mockRouteParams,
  setupRequestHandlers,
  startMSW,
} from '../mockRequests.js'

let clearOrgClients: (() => Promise<void>) | undefined

beforeAll(async () => {
  clearOrgClients = await importClearOrgClients()

  const cellMocks = findCellMocks(getPaths().web.src)

  for (const m of cellMocks) {
    // Importing the mock files registers the cell mock data as global MSW
    // request handlers.
    // See packages/vite/src/plugins/vite-plugin-cedar-mock-cell-data.ts
    await import(m)
  }

  await startMSW('node')
  // Register the handlers that were queued before the server started
  setupRequestHandlers()
})

afterEach(async () => {
  // Reset the handlers in each test
  setupRequestHandlers()

  // Each test starts with no route params, so outside any organization
  mockRouteParams({})

  // The per-organization Apollo clients live for the whole test file, so
  // one test's cached query results would answer the next test's queries
  await clearOrgClients?.()
})

afterAll(() => {
  closeServer()
})

/**
 * `clearOrgClients` from the app's `@cedarjs/tenancy/web`, or `undefined` in
 * an app without tenancy. It's resolved from the web side, where the app's
 * own code imports it from, so it clears the same clients.
 */
async function importClearOrgClients() {
  let tenancyWebPath: string

  try {
    tenancyWebPath = createRequire(
      path.join(getPaths().web.base, 'package.json'),
    ).resolve('@cedarjs/tenancy/web')
  } catch {
    return undefined
  }

  const tenancyWeb: unknown = await import(pathToFileURL(tenancyWebPath).href)

  if (
    tenancyWeb &&
    typeof tenancyWeb === 'object' &&
    'clearOrgClients' in tenancyWeb &&
    typeof tenancyWeb.clearOrgClients === 'function'
  ) {
    const clear = tenancyWeb.clearOrgClients

    return async () => {
      await clear()
    }
  }

  return undefined
}
