/* eslint-env jest */

import '@testing-library/jest-dom'

import { findCellMocks } from '../../../web/findCellMocks.js'
import {
  startMSW,
  setupRequestHandlers,
  closeServer,
  mockGraphQLMutation as _mockGraphQLMutation,
  mockGraphQLQuery as _mockGraphQLQuery,
  mockCurrentUser as _mockCurrentUser,
} from '../../../web/mockRequests.js'

declare global {
  // eslint-disable-next-line no-var
  var __RWJS_TESTROOT_DIR: string
  // eslint-disable-next-line no-var
  var mockCurrentUser: typeof _mockCurrentUser
}

global.mockGraphQLQuery = _mockGraphQLQuery
global.mockGraphQLMutation = _mockGraphQLMutation
global.mockCurrentUser = _mockCurrentUser

// NOTE: for performance reasons, we're not using rwjs/internal here
// This way we can make sure only the imports we require are loaded
const cellMocks = findCellMocks(global.__RWJS_TESTROOT_DIR)

beforeAll(async () => {
  for (const m of cellMocks) {
    // Keep in mind, its actually loading MSW mockGraphQLCall functions
    // see packages/vite/src/plugins/vite-plugin-cedar-mock-cell-data.ts
    await import(m)
  }

  await startMSW('node')
  setupRequestHandlers() // reset the handlers
})

afterEach(() => {
  setupRequestHandlers() // reset the handlers in each test.
})

afterAll(() => {
  closeServer()
})
