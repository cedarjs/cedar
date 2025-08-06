/* eslint-disable no-var */
import type { Global as jest } from '@jest/types'
type TestAPI = jest.It
type SuiteAPI = jest.Describe

import type {
  mockGraphQLMutation as mockGqlMutation,
  mockGraphQLQuery as mockGqlQuery,
  mockCurrentUser as mockCurrUser,
} from '@cedarjs/testing/dist/cjs/web/mockRequests'

import type { DefineScenario } from './src/api/scenario.ts'

declare global {
  var scenario: (
    ...args:
      | [
          scenarioName: string,
          testName: string,
          testFunc: (scenarioData: any) => any,
        ]
      | [testName: string, testFunc: (scenarioData: any) => any]
  ) => void
  var describeScenario: (
    ...args:
      | [string, string, (getScenario: () => any) => any]
      | [string, (getScenario: () => any) => any]
  ) => ReturnType<SuiteAPI>
  var describe: SuiteAPI
  var it: TestAPI
  var testPath: string
  var defineScenario: DefineScenario

  var mockCurrentUser: typeof mockCurrUser
  var mockGraphQLMutation: typeof mockGqlMutation
  var mockGraphQLQuery: typeof mockGqlQuery

  var __RWJS__TEST_IMPORTS: {
    apiSrcPath: string
    tearDownCachePath: string
    dbSchemaPath: string
  }
  var __RWJS_TESTROOT_DIR: string
}
