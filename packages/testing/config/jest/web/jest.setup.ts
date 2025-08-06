/* eslint-env jest */

import '@testing-library/jest-dom'
import 'whatwg-fetch'

const {
  findCellMocks,
} = require('@cedarjs/testing/dist/cjs/web/findCellMocks.js')
const {
  startMSW,
  setupRequestHandlers,
  closeServer,
  mockGraphQLMutation,
  mockGraphQLQuery,
  mockCurrentUser,
} = require('@cedarjs/testing/dist/cjs/web/mockRequests.js')

declare global {
  // eslint-disable-next-line no-var
  var mockGraphQLQuery: any
  // eslint-disable-next-line no-var
  var mockGraphQLMutation: any
  // eslint-disable-next-line no-var
  var mockCurrentUser: (currentUser: any) => void
  // eslint-disable-next-line no-var
  var __RWJS_TESTROOT_DIR: string
}

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
