import { afterAll, afterEach, beforeAll } from 'vitest'

import { getPaths } from '@cedarjs/project-config'

import { loadAppPermissions } from '../../permissions/loadAppPermissions.js'
import { setMockPermissionDefinitions } from '../../permissions/mockPermissions.js'
import { findCellMocks } from '../findCellMocks.js'
import {
  closeServer,
  mockRouteParams,
  setupRequestHandlers,
  startMSW,
} from '../mockRequests.js'

// Before the test file runs, so a `mockCurrentUser()` anywhere in it gets
// the permissions of the user's roles
setMockPermissionDefinitions(await loadAppPermissions(getPaths().web.base))

let clearOrgClients: (() => Promise<void>) | undefined

beforeAll(async () => {
  // `@cedarjs/tenancy/web` as the app's own code gets it, so it clears the
  // same clients. `undefined` in an app without tenancy. The module is
  // resolved by `cedarVitestWebConfigPlugin`. It's imported here, after the
  // test file's imports, so a `vi.resetModules()` in the test file still
  // leaves this the instance the app uses
  const tenancyWeb = await import('virtual:cedar-testing-tenancy-web')
  clearOrgClients = tenancyWeb.clearOrgClients

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
