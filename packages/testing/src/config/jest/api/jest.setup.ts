/* eslint-env jest */

import fs from 'node:fs'
import path from 'node:path'

// @NOTE without these imports in the setup file, mockCurrentUser
// will remain undefined in the user's tests
import { defineScenario } from '../../../api/scenario.js'

// @NOTE we do this because jest.setup.js runs every time in each context while
// jest-preset runs once. This significantly reduces memory footprint, and
// testing time
// The key is to reduce the amount of imports in this file, because the
// require.cache is not shared between each test context
const { apiSrcPath, tearDownCachePath, dbSchemaPath } =
  global.__RWJS__TEST_IMPORTS

interface ScenarioData {
  [model: string]: {
    [name: string]: any
  }
}

type ScenarioDefinition = {
  [model: string]: {
    [name: string]: any | ((scenarios: ScenarioData) => any)
  }
}

type ScenarioTestFunction = (scenarioData: ScenarioData) => Promise<any> | any

global.defineScenario = defineScenario

// Attempt to emulate the request context isolation behavior
// This is a little more complicated than it would necessarily need to be
// but we're following the same pattern as in `@cedarjs/context`
const mockContextStore = new Map<string, any>()
const mockContext = new Proxy(
  {},
  {
    get: (_target, prop) => {
      // Handle toJSON() calls, i.e. JSON.stringify(context)
      if (prop === 'toJSON') {
        return () => mockContextStore.get('context')
      }
      return mockContextStore.get('context')[prop]
    },
    set: (_target, prop, value) => {
      const ctx = mockContextStore.get('context')
      ctx[prop] = value
      return true
    },
  },
)

global.mockCurrentUser = (currentUser: Record<string, unknown> | null) => {
  mockContextStore.set('context', { currentUser })
}

// Error codes thrown by [MySQL, SQLite, Postgres] when foreign key constraint
// fails on DELETE
const FOREIGN_KEY_ERRORS = [1451, 1811, 23503]
const TEARDOWN_CACHE_PATH = tearDownCachePath
const DEFAULT_SCENARIO = 'standard'
let teardownOrder: string[] = []
let originalTeardownOrder: string[] = []

const deepCopy = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj))
}

const isIdenticalArray = (a: unknown[], b: unknown[]) => {
  return JSON.stringify(a) === JSON.stringify(b)
}

const configureTeardown = async (): Promise<void> => {
  const { getDMMF, getSchema } = await import('@prisma/internals')

  // @NOTE prisma utils are available in cli lib/schemaHelpers
  // But avoid importing them, to prevent memory leaks in jest
  const datamodel = await getSchema(dbSchemaPath)
  const schema = await getDMMF({ datamodel })
  const schemaModels: string[] = schema.datamodel.models.map(
    (m: { dbName: string | null; name: string }) => m.dbName || m.name,
  )

  // check if pre-defined delete order already exists and if so, use it to start
  if (fs.existsSync(TEARDOWN_CACHE_PATH)) {
    teardownOrder = JSON.parse(fs.readFileSync(TEARDOWN_CACHE_PATH).toString())
  }

  // check the number of models in case we've added/removed since cache was built
  if (teardownOrder.length !== schemaModels.length) {
    teardownOrder = schemaModels
  }

  // keep a copy of the original order to compare against
  originalTeardownOrder = deepCopy(teardownOrder)
}

let quoteStyle: string
// determine what kind of quotes are needed around table names in raw SQL
const getQuoteStyle = async (): Promise<string> => {
  const { getConfig: getPrismaConfig, getSchema } = await import(
    '@prisma/internals'
  )

  // @NOTE prisma utils are available in cli lib/schemaHelpers
  // But avoid importing them, to prevent memory leaks in jest
  const datamodel = await getSchema(dbSchemaPath)

  if (!quoteStyle) {
    const config = await getPrismaConfig({
      datamodel,
    })

    switch (config.datasources?.[0]?.provider) {
      case 'mysql':
        quoteStyle = '`'
        break
      default:
        quoteStyle = '"'
    }
  }

  return quoteStyle
}

const getProjectDb = async () => {
  // Use dynamic import for runtime module resolution
  const { db } = await import(`${apiSrcPath}/lib/db`)
  return db
}

/**
 * Wraps "it" or "test", to seed and teardown the scenario after each test
 * This one passes scenario data to the test function
 */
function buildScenario(itFunc: jest.It, testPath: string) {
  const scenarioFunc = (...args: any[]) => {
    let scenarioName: string, testName: string, testFunc: ScenarioTestFunction

    if (args.length === 3) {
      ;[scenarioName, testName, testFunc] = args
    } else if (args.length === 2) {
      scenarioName = DEFAULT_SCENARIO
      ;[testName, testFunc] = args
    } else {
      throw new Error('scenario() requires 2 or 3 arguments')
    }

    return itFunc(testName, async () => {
      const { scenario } = await loadScenarios(testPath, scenarioName)

      const scenarioData = await seedScenario(scenario)
      try {
        const result = await testFunc(scenarioData)

        return result
      } finally {
        // Make sure to cleanup, even if test fails
        if (wasDbUsed()) {
          await teardown()
        }
      }
    })
  }

  return Object.assign(scenarioFunc, { only: scenarioFunc })
}

/**
 * This creates a describe() block that will seed the scenario ONCE before all tests in the block
 * Note that you need to use the getScenario() function to get the data.
 */
function buildDescribeScenario(describeFunc: jest.Describe, testPath: string) {
  const describeScenarioFunc = (
    ...args:
      | [string, string, (getScenario: () => any) => any]
      | [string, (getScenario: () => any) => any]
  ) => {
    let scenarioName: string,
      describeBlockName: string,
      describeBlock: (getScenario: () => ScenarioData) => void

    if (args.length === 3) {
      ;[scenarioName, describeBlockName, describeBlock] = args
    } else if (args.length === 2) {
      scenarioName = DEFAULT_SCENARIO
      ;[describeBlockName, describeBlock] = args
    } else {
      throw new Error('describeScenario() requires 2 or 3 arguments')
    }

    return describeFunc(describeBlockName, () => {
      let scenarioData: ScenarioData
      beforeAll(async () => {
        const { scenario } = await loadScenarios(testPath, scenarioName)
        scenarioData = await seedScenario(scenario)
      })

      afterAll(async () => {
        if (wasDbUsed()) {
          await teardown()
        }
      })

      const getScenario = (): ScenarioData => scenarioData

      describeBlock(getScenario)
    })
  }

  return Object.assign(describeScenarioFunc, { only: describeScenarioFunc })
}

const teardown = async (): Promise<void> => {
  const quoteStyle = await getQuoteStyle()

  for (let i = 0; i < teardownOrder.length; i++) {
    const modelName = teardownOrder[i]
    if (!modelName) {
      continue
    }

    try {
      const db = await getProjectDb()
      await db.$executeRawUnsafe(
        `DELETE FROM ${quoteStyle}${modelName}${quoteStyle}`,
      )
    } catch (e: unknown) {
      const message = isErrorWithMessage(e) ? e.message : ''
      const match = message.match(/Code: `(\d+)`/)

      if (match && FOREIGN_KEY_ERRORS.includes(parseInt(match[1]))) {
        // Remove the model that failed and add it to the end
        teardownOrder.splice(i, 1)
        teardownOrder.push(modelName)
        i-- // Adjust index since we removed an element
      } else {
        throw e
      }
    }
  }

  // if the order of delete changed, write out the cached file again
  if (!isIdenticalArray(teardownOrder, originalTeardownOrder)) {
    originalTeardownOrder = deepCopy(teardownOrder)
    fs.writeFileSync(TEARDOWN_CACHE_PATH, JSON.stringify(teardownOrder))
  }
}

const seedScenario = async (
  scenario: ScenarioDefinition | undefined,
): Promise<ScenarioData> => {
  if (scenario) {
    const scenarios: ScenarioData = {}
    const db = await getProjectDb()
    for (const [model, namedFixtures] of Object.entries(scenario)) {
      scenarios[model] = {}

      for (const [name, createArgs] of Object.entries(namedFixtures)) {
        if (typeof createArgs === 'function') {
          scenarios[model][name] = await db[model].create(createArgs(scenarios))
        } else {
          scenarios[model][name] = await db[model].create(createArgs)
        }
      }
    }

    return scenarios
  } else {
    return {}
  }
}

global.scenario = buildScenario(global.it, global.testPath)
global.describeScenario = buildDescribeScenario(
  global.describe,
  global.testPath,
)

/**
 * All these hooks run in the VM/Context that the test runs in since we're using "setupAfterEnv".
 * There's a new context for each test-suite i.e. each test file
 *
 * Doing this means if the db isn't used in the current test context,
 * no need to do any of the teardown logic - allowing simple tests to run faster
 * At the same time, if the db is used, disconnecting it in this context prevents connection limit errors.
 * Just disconnecting db in jest-preset is not enough, because
 * the Prisma client is created in a different context.
 */
const wasDbUsed = () => {
  try {
    const libDbPath = require.resolve(`${apiSrcPath}/lib/db`)
    return Object.keys(require.cache).some((module) => {
      return module === libDbPath
    })
  } catch {
    // If db wasn't resolved, no point trying to perform db resets
    return false
  }
}

jest.mock('@cedarjs/context', () => {
  return {
    context: mockContext,
    setContext: (newContext: any) => {
      mockContextStore.set('context', newContext)
    },
  }
})

beforeEach(() => {
  mockContextStore.set('context', {})
})

beforeAll(async () => {
  if (wasDbUsed()) {
    await configureTeardown()
  }
})

afterAll(async () => {
  if (wasDbUsed()) {
    const db = await getProjectDb()
    db.$disconnect()
  }
})

async function loadScenarios(
  testPath: string,
  scenarioName: string,
): Promise<{ scenario: ScenarioDefinition | undefined }> {
  const testFileDir = path.parse(testPath)
  // e.g. ['comments', 'test'] or ['signup', 'state', 'machine', 'test']
  const testFileNameParts = testFileDir.name.split('.')
  const testFilePath = `${testFileDir.dir}/${testFileNameParts
    .slice(0, testFileNameParts.length - 1)
    .join('.')}.scenarios`
  let allScenarios: { [key: string]: ScenarioDefinition } | undefined
  let scenario: ScenarioDefinition | undefined

  try {
    allScenarios = await import(testFilePath)
  } catch (e: unknown) {
    // ignore error if scenario file not found, otherwise re-throw
    if (isErrorWithCode(e) && e.code !== 'MODULE_NOT_FOUND') {
      throw new Error(`Failed to load scenario: ${e}`)
    }
    // If it's MODULE_NOT_FOUND, we ignore it
  }

  if (allScenarios) {
    if (allScenarios[scenarioName]) {
      scenario = allScenarios[scenarioName]
    } else {
      throw new Error(
        `UndefinedScenario: There is no scenario named "${scenarioName}" in ${testFilePath}.{js,ts}`,
      )
    }
  }
  return { scenario }
}

function isErrorWithCode(error: unknown): error is { code: string } {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    !!error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}
