import '@testing-library/jest-dom'
import 'whatwg-fetch'

import { findCellMocks } from '@cedarjs/testing/dist/cjs/web/findCellMocks.js'
import {
  startMSW,
  setupRequestHandlers,
  closeServer,
  mockGraphQLMutation,
  mockGraphQLQuery,
  mockCurrentUser,
} from '@cedarjs/testing/dist/cjs/web/mockRequests.js'

global.mockGraphQLQuery = mockGraphQLQuery
global.mockGraphQLMutation = mockGraphQLMutation
global.mockCurrentUser = mockCurrentUser

// NOTE: for performance reasons, we're not using rwjs/internal here
// This way we can make sure only the imports we require are loaded
const cellMocks = findCellMocks(global.__RWJS_TESTROOT_DIR)

beforeAll(async () => {
  for (const m of cellMocks) {
    // Keep in mind, its actually loading MSW mockGraphQLCall functions
    // see packages/internal/src/build/babelPlugins/babel-plugin-redwood-mock-cell-data.ts
    require(m)
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
