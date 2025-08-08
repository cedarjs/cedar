/* eslint-disable no-var */

import type { DefineScenario } from './src/api/scenario.ts'
import type {
  mockGraphQLMutation as mockGqlMutation,
  mockGraphQLQuery as mockGqlQuery,
  mockCurrentUser as mockCurrUser,
} from './src/web/mockRequests.ts'

type It = typeof global.it
type Describe = typeof global.describe
type TestFunc = (scenarioData: any) => any
type DescribeBlock = (getScenario: () => any) => any

interface GlobalScenario {
  (...args: [string, string, TestFunc] | [string, TestFunc]): ReturnType<It>
  only?: (
    ...args: [string, string, TestFunc] | [string, TestFunc]
  ) => ReturnType<It>
}

interface DescribeScenario {
  (
    ...args: [string, string, DescribeBlock] | [string, DescribeBlock]
  ): ReturnType<Describe>
  only?: (
    ...args: [string, string, DescribeBlock] | [string, DescribeBlock]
  ) => ReturnType<Describe>
}

declare global {
  var scenario: GlobalScenario
  var describeScenario: DescribeScenario
  var describe: Describe
  var it: It
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
