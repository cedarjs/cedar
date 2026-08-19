import { afterAll, afterEach, beforeAll } from 'vitest'

import { getPaths } from '@cedarjs/project-config'

import { findCellMocks } from '../findCellMocks.js'
import { closeServer, setupRequestHandlers, startMSW } from '../mockRequests.js'

beforeAll(async () => {
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

afterEach(() => {
  // Reset the handlers in each test
  setupRequestHandlers()
})

afterAll(() => {
  closeServer()
})
