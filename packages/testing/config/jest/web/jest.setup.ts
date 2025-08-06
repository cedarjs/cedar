/* eslint-env jest */

import '@testing-library/jest-dom'
import 'whatwg-fetch'

import { findCellMocks } from '@cedarjs/testing/dist/cjs/web/findCellMocks'
import {
  startMSW,
  setupRequestHandlers,
  closeServer,
  mockGraphQLMutation as _mockGraphQLMutation,
  mockGraphQLQuery as _mockGraphQLQuery,
  mockCurrentUser as _mockCurrentUser,
} from '@cedarjs/testing/dist/cjs/web/mockRequests'

declare global {
  // eslint-disable-next-line no-var
  var __RWJS_TESTROOT_DIR: string
}

global.mockGraphQLQuery = _mockGraphQLQuery
global.mockGraphQLMutation = _mockGraphQLMutation
global.mockCurrentUser = _mockCurrentUser

// NOTE: for performance reasons, we're not using rwjs/internal here
// This way we can make sure only the imports we require are loaded
const cellMocks = findCellMocks(global.__RWJS_TESTROOT_DIR)

beforeAll(async () => {
  const { createRequire } = require('node:module')
  const requireFn = createRequire(__filename)

  for (const m of cellMocks) {
    // Keep in mind, its actually loading MSW mockGraphQLCall functions
    // see packages/internal/src/build/babelPlugins/babel-plugin-redwood-mock-cell-data.ts
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
