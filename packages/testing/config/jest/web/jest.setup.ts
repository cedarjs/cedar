/* eslint-env jest */

import '@testing-library/jest-dom'
import 'whatwg-fetch'

import { findCellMocks } from '../../../web/findCellMocks.js'
import {
  startMSW,
  setupRequestHandlers,
  closeServer,
  mockGraphQLMutation,
  mockGraphQLQuery,
  mockCurrentUser,
} from '../../../web/mockRequests.js'

declare global {
  // eslint-disable-next-line no-var
  var mockGraphQLQuery: (
    operation: string,
    data: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ) => void
  // eslint-disable-next-line no-var
  var mockGraphQLMutation: (
    operation: string,
    data: Record<string, unknown>,
    variables?: Record<string, unknown>,
  ) => void
  // eslint-disable-next-line no-var
  var mockCurrentUser: (currentUser: Record<string, unknown>) => void
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
    const { createRequire } = require('node:module')
    const requireFn = createRequire(__filename)
    requireFn(m)
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
